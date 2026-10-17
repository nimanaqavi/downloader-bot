package bot

import (
	"context"
	"fmt"
	"strings"
	"sync"

	tele "gopkg.in/telebot.v3"

	"mimo/internal/admin"
	"mimo/internal/config"
	"mimo/internal/database"
	"mimo/internal/downloader"
	"mimo/internal/mtproto"
	"mimo/internal/utils"
)

type WebhookPoller struct {
	stop chan struct{}
}

func (p *WebhookPoller) Poll(b *tele.Bot, dest chan tele.Update, stop chan struct{}) {
	p.stop = stop
	<-stop
}

type BotServer struct {
	Bot          *tele.Bot
	Config       *config.Config
	DB           *database.DB
	Downloader   *downloader.Downloader
	Queue        *downloader.Queue
	Uploader     *mtproto.Uploader
	BroadcastMgr *admin.BroadcastManager
	pendingLinks map[int64]string
	mu           sync.Mutex
}

func NewBotServer(
	cfg *config.Config,
	db *database.DB,
	dl *downloader.Downloader,
	queue *downloader.Queue,
	uploader *mtproto.Uploader,
) (*BotServer, error) {
	pref := tele.Settings{
		Token:  cfg.BotToken,
		Poller: &WebhookPoller{}, // Custom Webhook Poller: no LongPoller background requests!
	}

	b, err := tele.NewBot(pref)
	if err != nil {
		return nil, fmt.Errorf("create telebot: %w", err)
	}

	bm := admin.NewBroadcastManager()
	pendingLinks := make(map[int64]string)

	srv := &BotServer{
		Bot:          b,
		Config:       cfg,
		DB:           db,
		Downloader:   dl,
		Queue:        queue,
		Uploader:     uploader,
		BroadcastMgr: bm,
		pendingLinks: pendingLinks,
	}

	srv.setupMiddleware()
	srv.setupHandlers()

	return srv, nil
}

func (s *BotServer) setupMiddleware() {
	s.Bot.Use(func(next tele.HandlerFunc) tele.HandlerFunc {
		return func(c tele.Context) error {
			sender := c.Sender()
			if sender == nil {
				return next(c)
			}

			// 1. Get or create user & update activity
			user, err := s.DB.GetOrCreateUser(sender.ID, sender.Username)
			if err == nil && user != nil {
				if user.IsBanned {
					return nil // Ignore banned users completely
				}
			}

			// 2. Broadcast Receiver for Admin
			if s.Config.AdminUserIDs[sender.ID] {
				if targetLang, isWaiting := s.BroadcastMgr.IsWaiting(sender.ID); isWaiting {
					msg := c.Message()
					if msg != nil && !strings.HasPrefix(msg.Text, "/") {
						s.BroadcastMgr.CancelWaiting(sender.ID)
						go s.BroadcastMgr.Execute(
							context.Background(),
							s.Bot,
							s.DB,
							c.Recipient(),
							msg,
							targetLang,
						)
						return nil
					}
				}
			}

			return next(c)
		}
	})
}

func (s *BotServer) setupHandlers() {
	dlHandler := NewDownloadHandler(
		s.Bot,
		s.Config,
		s.DB,
		s.Downloader,
		s.Queue,
		s.Uploader,
		s.pendingLinks,
	)

	// Register Start Handlers (/start, /help, /language)
	RegisterStartHandlers(s.Bot, s.Config, s.DB)

	// Register History Command (/history)
	RegisterHistoryHandlers(s.Bot, s.DB)

	// Register Admin Commands (/admin, /cancel, /ban, /unban, /setchannel, /setemoji)
	admin.RegisterAdminHandlers(s.Bot, s.Config, s.DB, s.BroadcastMgr, s.Queue)

	// Register Master Callback Router (Single central router for ALL callbacks: lang, hist, q, cancel, mp3, adm)
	s.RegisterMasterCallback(dlHandler)

	// Text Message Handler (link extraction)
	s.Bot.Handle(tele.OnText, func(c tele.Context) error {
		text := strings.TrimSpace(c.Text())
		if strings.HasPrefix(text, "/") {
			return nil
		}

		rawURL, isAudio := utils.ExtractURLFromText(text)
		if rawURL != "" {
			if isAudio {
				rawURL = "mp3 " + rawURL
			}
			dlHandler.HandleLink(c, rawURL)
			return nil
		}

		return nil
	})

	// Register bot command list in Telegram Menu
	commands := []tele.Command{
		{Text: "start", Description: "شروع کار با ربات / Start bot"},
		{Text: "help", Description: "راهنمای استفاده / Help guide"},
		{Text: "language", Description: "تغییر زبان / Change language"},
		{Text: "history", Description: "تاریخچه دانلودها / Download history"},
	}
	_ = s.Bot.SetCommands(commands)
}
