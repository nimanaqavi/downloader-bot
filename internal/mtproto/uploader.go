package mtproto

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/gotd/td/session"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/message"
	"github.com/gotd/td/telegram/message/html"
	"github.com/gotd/td/telegram/uploader"
	"github.com/gotd/td/tg"
)

type Uploader struct {
	apiID     int
	apiHash   string
	botToken  string
	mu        sync.Mutex
	client    *telegram.Client
	cancelFn  context.CancelFunc
	idleTimer *time.Timer
}

func New(apiID int, apiHash, botToken string) *Uploader {
	return &Uploader{
		apiID:    apiID,
		apiHash:  apiHash,
		botToken: botToken,
	}
}

func (u *Uploader) resetIdleTimer() {
	if u.idleTimer != nil {
		u.idleTimer.Stop()
	}
	u.idleTimer = time.AfterFunc(60*time.Second, func() {
		u.Disconnect()
	})
}

func (u *Uploader) ensureClient(ctx context.Context) (*telegram.Client, error) {
	u.mu.Lock()
	defer u.mu.Unlock()

	u.resetIdleTimer()
	if u.client != nil {
		return u.client, nil
	}

	clientCtx, cancel := context.WithCancel(context.Background())
	u.cancelFn = cancel

	ready := make(chan struct{})
	var startErr error

	client := telegram.NewClient(u.apiID, u.apiHash, telegram.Options{
		SessionStorage: &session.StorageMemory{},
	})

	go func() {
		err := client.Run(clientCtx, func(ctx context.Context) error {
			status, err := client.Auth().Status(ctx)
			if err != nil {
				return err
			}
			if !status.Authorized {
				if _, err := client.Auth().Bot(ctx, u.botToken); err != nil {
					return fmt.Errorf("bot auth failed: %w", err)
				}
			}
			close(ready)
			<-ctx.Done()
			return nil
		})
		if err != nil && startErr == nil {
			startErr = err
		}
	}()

	select {
	case <-ready:
		u.client = client
		return client, nil
	case <-time.After(15 * time.Second):
		cancel()
		return nil, fmt.Errorf("mtproto connection timed out")
	case <-ctx.Done():
		cancel()
		return nil, ctx.Err()
	}
}

func (u *Uploader) Disconnect() {
	u.mu.Lock()
	defer u.mu.Unlock()

	if u.cancelFn != nil {
		u.cancelFn()
		u.cancelFn = nil
	}
	u.client = nil
	runtime.GC()
}

func (u *Uploader) UploadLargeFile(
	ctx context.Context,
	chatID int64,
	filePath string,
	caption string,
	isAudio bool,
) (int, error) {
	client, err := u.ensureClient(ctx)
	if err != nil {
		return 0, fmt.Errorf("ensure mtproto client: %w", err)
	}

	raw := client.API()
	up := uploader.NewUploader(raw).WithThreads(1)
	file, err := up.FromPath(ctx, filePath)
	if err != nil {
		return 0, fmt.Errorf("mtproto upload from path: %w", err)
	}

	sender := message.NewSender(raw)
	peer := sender.Resolve(strconv.FormatInt(chatID, 10))

	var msgID int
	if isAudio {
		res, err := peer.Audio(ctx, file, html.String(nil, caption))
		if err != nil {
			return 0, fmt.Errorf("send audio document: %w", err)
		}
		if updates, ok := res.(*tg.Updates); ok && len(updates.Updates) > 0 {
			for _, upd := range updates.Updates {
				if msg, ok := upd.(*tg.UpdateNewMessage); ok {
					if m, ok := msg.Message.(*tg.Message); ok {
						msgID = m.ID
					}
				}
			}
		}
	} else {
		res, err := peer.Video(ctx, file, html.String(nil, caption))
		if err != nil {
			return 0, fmt.Errorf("send video document: %w", err)
		}
		if updates, ok := res.(*tg.Updates); ok && len(updates.Updates) > 0 {
			for _, upd := range updates.Updates {
				if msg, ok := upd.(*tg.UpdateNewMessage); ok {
					if m, ok := msg.Message.(*tg.Message); ok {
						msgID = m.ID
					}
				}
			}
		}
	}

	u.resetIdleTimer()
	return msgID, nil
}
