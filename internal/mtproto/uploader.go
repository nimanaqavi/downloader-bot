package mtproto

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
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
	timerMu   sync.Mutex
	uploading atomic.Bool
}

func New(apiID int, apiHash, botToken string) *Uploader {
	return &Uploader{
		apiID:    apiID,
		apiHash:  apiHash,
		botToken: botToken,
	}
}

const idleTimeout = 60 * time.Second

func (u *Uploader) resetIdleTimer() {
	u.timerMu.Lock()
	defer u.timerMu.Unlock()
	if u.idleTimer != nil {
		u.idleTimer.Stop()
	}
	u.idleTimer = time.AfterFunc(idleTimeout, u.idleTick)
}

// idleTick tears down an idle client to give the RAM back, but never while an
// upload is in flight: a 180 MB file takes minutes and cancelling the client
// mid-transfer aborts the whole send ("engine forcibly closed: context
// canceled"). Instead it re-arms itself and checks again later.
func (u *Uploader) idleTick() {
	if u.uploading.Load() {
		u.resetIdleTimer()
		return
	}
	u.Disconnect()
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
		log.Println("[mtproto] client connected and authorized successfully")
		return client, nil
	case <-time.After(15 * time.Second):
		cancel()
		log.Printf("[mtproto error] connection timed out (startErr=%v)", startErr)
		return nil, fmt.Errorf("mtproto connection timed out (startErr: %v)", startErr)
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
	log.Println("[mtproto] client disconnected")
	runtime.GC()
}

func getInputPeer(chatID int64) tg.InputPeerClass {
	if chatID > 0 {
		return &tg.InputPeerUser{UserID: chatID, AccessHash: 0}
	}
	if chatID <= -1000000000000 {
		return &tg.InputPeerChannel{ChannelID: -(chatID + 1000000000000), AccessHash: 0}
	}
	return &tg.InputPeerChat{ChatID: -chatID}
}

// progressReader reports cumulative upload percentage to cb on every read.
type progressReader struct {
	r     io.Reader
	total int64
	read  int64
	cb    func(int)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.read += int64(n)
	if p.cb != nil && p.total > 0 {
		p.cb(int(p.read * 100 / p.total))
	}
	return n, err
}

func (u *Uploader) UploadLargeFile(
	ctx context.Context,
	chatID int64,
	filePath string,
	caption string,
	isAudio bool,
	onProgress func(int),
) (int, error) {
	log.Printf("[mtproto] starting large file upload (chatID=%d, file=%s, isAudio=%v)", chatID, filePath, isAudio)
	client, err := u.ensureClient(ctx)
	if err != nil {
		log.Printf("[mtproto error] ensureClient failed: %v", err)
		return 0, fmt.Errorf("ensure mtproto client: %w", err)
	}

	// Keep the idle watchdog away for the whole transfer; it is re-armed below.
	u.uploading.Store(true)
	defer func() {
		u.uploading.Store(false)
		u.resetIdleTimer()
	}()

	raw := client.API()
	// 8 parallel part uploads; the single-threaded default capped us near
	// 600 KB/s. 8 x 512 KB in flight costs ~4 MB of RAM.
	up := uploader.NewUploader(raw).WithThreads(8)

	f, err := os.Open(filePath)
	if err != nil {
		log.Printf("[mtproto error] open media failed: %v", err)
		return 0, fmt.Errorf("open media: %w", err)
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return 0, fmt.Errorf("stat media: %w", err)
	}

	file, err := up.FromReader(ctx, filepath.Base(filePath), &progressReader{r: f, total: st.Size(), cb: onProgress})
	if err != nil {
		log.Printf("[mtproto error] upload failed: %v", err)
		return 0, fmt.Errorf("mtproto upload: %w", err)
	}

	sender := message.NewSender(raw)
	peer := sender.To(getInputPeer(chatID))

	var msgID int
	if isAudio {
		res, err := peer.Audio(ctx, file, html.String(nil, caption))
		if err != nil {
			log.Printf("[mtproto error] peer.Audio failed: %v", err)
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
		res, err := peer.Media(ctx, message.Video(file, html.String(nil, caption)).SupportsStreaming())
		if err != nil {
			log.Printf("[mtproto error] peer.Video failed: %v", err)
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

	log.Printf("[mtproto] upload completed successfully, msgID=%d", msgID)
	u.resetIdleTimer()
	return msgID, nil
}
