package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	BotToken               string
	AdminUserIDs           map[int64]bool
	AdminIDsSlice          []int64
	DatabasePath           string
	RateLimitMax           int
	RateLimitWindowSec     int
	TelegramFileLimitBytes int64
	TelegramAPIID          int
	TelegramAPIHash        string
	DownloadTimeoutSec     int
	AutoUpdateYtDlp        bool
	CookiesPath            string
	InstagramCookiesPath   string
	MaxDurationSec         int
	DiskSafetyMarginBytes  int64
	MaxDiskBudgetMB        int64
	StorageChannelID       string
	BotUsername            string
	TikTokProvider         string
	WebhookDomain          string
	Port                   string
	Host                   string
	TempDir                string
}

// LoadEnvFile optionally loads key-value pairs from a .env file into the environment
func LoadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.TrimSpace(parts[1])
			v = strings.Trim(v, `"'`)
			if k == "TMPDIR" || os.Getenv(k) == "" {
				os.Setenv(k, v)
			}
		}
	}
}

func Load() (*Config, error) {
	LoadEnvFile(".env")

	botToken := strings.TrimSpace(os.Getenv("BOT_TOKEN"))
	if botToken == "" {
		return nil, fmt.Errorf("BOT_TOKEN is required")
	}

	rawAdminIDs := strings.TrimSpace(os.Getenv("ADMIN_USER_IDS"))
	if rawAdminIDs == "" {
		return nil, fmt.Errorf("ADMIN_USER_IDS is required")
	}

	adminMap := make(map[int64]bool)
	var adminSlice []int64
	for _, raw := range strings.Split(rawAdminIDs, ",") {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid admin user ID '%s': %w", s, err)
		}
		adminMap[id] = true
		adminSlice = append(adminSlice, id)
	}

	dbPath := os.Getenv("DATABASE_PATH")
	if dbPath == "" {
		dbPath = "./data/bot.db"
	}
	absDbPath, _ := filepath.Abs(dbPath)

	rateLimitMax := getEnvInt("RATE_LIMIT_MAX", 3)
	rateLimitWindow := getEnvInt("RATE_LIMIT_WINDOW_SECONDS", 60)
	fileLimitMB := getEnvInt64("TELEGRAM_FILE_LIMIT_MB", 500)
	apiID := getEnvInt("TELEGRAM_API_ID", 2040)
	apiHash := getEnvString("TELEGRAM_API_HASH", "b18441a1ff607e10a989891a5462e627")
	downloadTimeout := getEnvInt("DOWNLOAD_TIMEOUT_SECONDS", 300)
	autoUpdate := getEnvBool("AUTO_UPDATE_YTDLP", true)

	cookiesPath := os.Getenv("COOKIES_PATH")
	igCookiesPath := os.Getenv("INSTAGRAM_COOKIES_PATH")
	if cookiesPath == "" && igCookiesPath != "" {
		cookiesPath = igCookiesPath
	}
	if igCookiesPath == "" && cookiesPath != "" {
		igCookiesPath = cookiesPath
	}

	maxDuration := getEnvInt("MAX_DURATION_SECONDS", 10800)
	diskMarginMB := getEnvInt64("DISK_SAFETY_MARGIN_MB", 100)
	maxDiskBudgetMB := getEnvInt64("MAX_DISK_BUDGET_MB", 1000)
	storageChannelID := os.Getenv("STORAGE_CHANNEL_ID")
	botUsername := strings.TrimPrefix(getEnvString("BOT_USERNAME", "instagramdl_mahibot"), "@")
	tiktokProvider := getEnvString("TIKTOK_PROVIDER", "tikwm_first")
	webhookDomain := os.Getenv("WEBHOOK_DOMAIN")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8100"
	}
	host := os.Getenv("IP")
	if host == "" {
		host = os.Getenv("HOST")
	}
	if host == "" {
		host = "0.0.0.0"
	}

	tmpDir := os.Getenv("TMPDIR")
	if tmpDir == "" {
		tmpDir = "./tmp"
	}
	absTmpDir, _ := filepath.Abs(tmpDir)

	return &Config{
		BotToken:               botToken,
		AdminUserIDs:           adminMap,
		AdminIDsSlice:          adminSlice,
		DatabasePath:           absDbPath,
		RateLimitMax:           rateLimitMax,
		RateLimitWindowSec:     rateLimitWindow,
		TelegramFileLimitBytes: fileLimitMB * 1024 * 1024,
		TelegramAPIID:          apiID,
		TelegramAPIHash:        apiHash,
		DownloadTimeoutSec:     downloadTimeout,
		AutoUpdateYtDlp:        autoUpdate,
		CookiesPath:            cookiesPath,
		InstagramCookiesPath:   igCookiesPath,
		MaxDurationSec:         maxDuration,
		DiskSafetyMarginBytes:  diskMarginMB * 1024 * 1024,
		MaxDiskBudgetMB:        maxDiskBudgetMB,
		StorageChannelID:       storageChannelID,
		BotUsername:            botUsername,
		TikTokProvider:         tiktokProvider,
		WebhookDomain:          webhookDomain,
		Port:                   port,
		Host:                   host,
		TempDir:                absTmpDir,
	}, nil
}

func getEnvString(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getEnvInt64(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}

func getEnvBool(key string, fallback bool) bool {
	v := strings.ToLower(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v == "true" || v == "1" || v == "yes"
}
