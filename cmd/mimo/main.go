package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	tele "gopkg.in/telebot.v3"

	"mimo/internal/bot"
	"mimo/internal/config"
	"mimo/internal/database"
	"mimo/internal/downloader"
	"mimo/internal/mtproto"
)

func main() {
	// 1. Lock V8/Go Memory Ceiling to 100 MiB to prevent server OOM
	debug.SetMemoryLimit(100 * 1024 * 1024)

	// 2. Load Configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[fatal] Config load failed: %v", err)
	}

	// Ensure physical temp directory exists on disk and override system TMPDIR (critical for tmpfs RAM limits)
	if err := os.MkdirAll(cfg.TempDir, 0755); err != nil {
		log.Fatalf("[fatal] Failed to create TempDir %s: %v", cfg.TempDir, err)
	}
	_ = os.Setenv("TMPDIR", cfg.TempDir)
	_ = os.Setenv("TEMP", cfg.TempDir)
	_ = os.Setenv("TMP", cfg.TempDir)
	log.Printf("[startup] Physical temp directory: %s", cfg.TempDir)

	// 3. Connect SQLite Database
	db, err := database.Connect(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("[fatal] Database connect failed: %v", err)
	}
	defer db.Close()
	log.Printf("[startup] SQLite database connected: %s", cfg.DatabasePath)

	// 4. Initialize Downloader Engine & Queue
	dl := downloader.New(cfg)
	queue := downloader.NewQueue(3)

	// 5. Initialize Lazy MTProto Uploader
	mtprotoUploader := mtproto.New(cfg.TelegramAPIID, cfg.TelegramAPIHash, cfg.BotToken)
	defer mtprotoUploader.Disconnect()

	// 6. Initialize Telegram Bot
	server, err := bot.NewBotServer(cfg, db, dl, queue, mtprotoUploader)
	if err != nil {
		log.Fatalf("[fatal] Bot server init failed: %v", err)
	}

	// 7. Cleanup orphaned temp directories from previous crashed runs
	cleanupOrphanedTempDirs(cfg.TempDir)

	// 8. Bind HTTP Webhook & Healthcheck server immediately for Alwaysdata
	listenAddr := net.JoinHostPort(cfg.Host, cfg.Port)
	if strings.Contains(cfg.Host, ":") && !strings.HasPrefix(cfg.Host, "[") {
		listenAddr = fmt.Sprintf("[%s]:%s", cfg.Host, cfg.Port)
	}

	webhookHandler := func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("✅ ربات تلگرام روشن و آماده است!"))
			return
		}

		if r.Method == http.MethodPost {
			// Telegram echoes WEBHOOK_SECRET in this header. Without the check,
			// anything that can reach the port could inject a forged update and
			// impersonate an admin by spoofing sender.id.
			if cfg.WebhookSecret != "" && r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != cfg.WebhookSecret {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			var update tele.Update
			if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			// Immediately return HTTP 200 OK to Telegram proxy (< 1ms)
			w.WriteHeader(http.StatusOK)

			// Process update asynchronously in goroutine
			go func(upd tele.Update) {
				defer func() {
					if rec := recover(); rec != nil {
						log.Printf("[panic] update processing recovered: %v", rec)
					}
				}()
				server.Bot.ProcessUpdate(upd)
			}(update)
			return
		}

		w.WriteHeader(http.StatusMethodNotAllowed)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", webhookHandler)
	mux.HandleFunc("/webhook", webhookHandler)

	httpServer := &http.Server{
		Addr:    listenAddr,
		Handler: mux,
	}

	go func() {
		log.Printf("[startup] HTTP Webhook Server listening on %s", listenAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fallbackAddr := fmt.Sprintf("0.0.0.0:%s", cfg.Port)
			httpServer.Addr = fallbackAddr
			log.Printf("[startup] Falling back to HTTP %s", fallbackAddr)
			_ = httpServer.ListenAndServe()
		}
	}()

	// 9. Register Webhook with Telegram API, or fall back to long polling
	if cfg.WebhookDomain != "" {
		webhookURL := fmt.Sprintf("https://%s/", cfg.WebhookDomain)
		go registerTelegramWebhook(cfg.BotToken, webhookURL, cfg.WebhookSecret)
		log.Printf("[startup] Webhook mode enabled: %s", webhookURL)
	} else {
		// No public webhook domain configured (e.g. the domain serves a
		// static site): use long polling so updates reach the bot directly.
		go func() {
			if err := server.Bot.RemoveWebhook(); err != nil {
				log.Printf("[startup] RemoveWebhook notice: %v", err)
			}
			longPoller := &tele.LongPoller{Timeout: 10}
			server.Bot.Poller = longPoller
			log.Println("[startup] Webhook domain not set; running via long polling")
			server.Bot.Start()
		}()
	}

	// 11. Auto-update yt-dlp nightly routine
	if cfg.AutoUpdateYtDlp {
		go scheduleYtDlpUpdates()
	}

	// 12. Watch restart trigger for zero-touch deploys via SSH
	triggerFile := filepath.Join(cfg.TempDir, "restart.trigger")
	_ = os.Remove(triggerFile)
	go func() {
		for {
			time.Sleep(2 * time.Second)
			if _, err := os.Stat(triggerFile); err == nil {
				_ = os.Remove(triggerFile)
				log.Println("[restart] Trigger file detected, exiting for supervisor respawn...")
				os.Exit(0)
			}
		}
	}()

	// 13. Handle Graceful Shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	sig := <-sigChan
	log.Printf("[shutdown] Received signal %v, shutting down gracefully...", sig)

	// Hard deadline: Alwaysdata's supervisor sends SIGTERM and waits. If a
	// subsystem blocks (Bot.Stop waiting on its loop) we must still exit, or
	// the site stays half-dead and never respawns.
	time.AfterFunc(10*time.Second, func() { os.Exit(0) })

	// Hard deadline: Alwaysdata's supervisor sends SIGTERM and waits. If a
	// subsystem blocks (Bot.Stop waiting on its loop) we must still exit, or
	// the site stays half-dead and never respawns.
	time.AfterFunc(10*time.Second, func() { os.Exit(0) })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)

	server.Bot.Stop()
	mtprotoUploader.Disconnect()
	_ = db.Close()
	runtime.GC()
	os.Exit(0)
}

func registerTelegramWebhook(token, webhookURL, secret string) {
	// Register allowed_updates=["message","callback_query"]
	apiURL := fmt.Sprintf(
		"https://api.telegram.org/bot%s/setWebhook?url=%s&allowed_updates=%%5B%%22message%%22,%%22callback_query%%22%%5D&drop_pending_updates=false",
		token, webhookURL,
	)
	if secret != "" {
		apiURL += "&secret_token=" + secret
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		log.Printf("[webhook] Failed to register webhook: %v", err)
		return
	}
	defer resp.Body.Close()

	var res struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&res)
	log.Printf("[webhook] Telegram setWebhook response: ok=%v description=%s", res.OK, res.Description)
}

func cleanupOrphanedTempDirs(dirs ...string) {
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(dir, "mimo-*"))
		for _, m := range matches {
			_ = os.RemoveAll(m)
		}
		tiktokMatches, _ := filepath.Glob(filepath.Join(dir, "tiktok-*"))
		for _, m := range tiktokMatches {
			_ = os.RemoveAll(m)
		}
	}
	// Also clean OS tempdir
	osTmp := os.TempDir()
	matches, _ := filepath.Glob(filepath.Join(osTmp, "mimo-*"))
	for _, m := range matches {
		_ = os.RemoveAll(m)
	}
	tiktokMatches, _ := filepath.Glob(filepath.Join(osTmp, "tiktok-*"))
	for _, m := range tiktokMatches {
		_ = os.RemoveAll(m)
	}
}

func scheduleYtDlpUpdates() {
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		log.Println("[dependencies] Running scheduled yt-dlp update check...")
		cmd := exec.Command("yt-dlp", "-U")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("[dependencies] yt-dlp update notice: %v", err)
		} else {
			log.Printf("[dependencies] yt-dlp updated: %s", strings.TrimSpace(string(out)))
		}
	}
}
