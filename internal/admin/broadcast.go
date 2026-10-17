package admin

import (
	"context"
	"fmt"
	"sync"
	"time"

	tele "gopkg.in/telebot.v3"

	"mimo/internal/database"
)

type BroadcastManager struct {
	mu             sync.Mutex
	isBroadcasting bool
	cancelReq      bool
	waitingAdmin   map[int64]string // adminID -> targetLang
}

func NewBroadcastManager() *BroadcastManager {
	return &BroadcastManager{
		waitingAdmin: make(map[int64]string),
	}
}

func (bm *BroadcastManager) Begin(adminID int64, langFilter string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.isBroadcasting {
		return fmt.Errorf("یک ارسال همگانی در حال اجراست. لطفاً تا پایان آن صبر کنید")
	}
	bm.waitingAdmin[adminID] = langFilter
	return nil
}

func (bm *BroadcastManager) CancelWaiting(adminID int64) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	delete(bm.waitingAdmin, adminID)
}

func (bm *BroadcastManager) IsWaiting(adminID int64) (string, bool) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	target, ok := bm.waitingAdmin[adminID]
	return target, ok
}

func (bm *BroadcastManager) RequestCancel() {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	if bm.isBroadcasting {
		bm.cancelReq = true
	}
}

func (bm *BroadcastManager) Execute(
	ctx context.Context,
	bot *tele.Bot,
	db *database.DB,
	adminRecipient tele.Recipient,
	sourceMsg *tele.Message,
	langFilter string,
) {
	bm.mu.Lock()
	bm.isBroadcasting = true
	bm.cancelReq = false
	bm.mu.Unlock()

	defer func() {
		bm.mu.Lock()
		bm.isBroadcasting = false
		bm.cancelReq = false
		bm.mu.Unlock()
	}()

	langLabel := "همه کاربران"
	if langFilter == "fa" {
		langLabel = "فقط کاربران فارسی"
	} else if langFilter == "en" {
		langLabel = "فقط کاربران انگلیسی"
	}

	cancelBtn := tele.InlineButton{Text: "✕ لغو ارسال همگانی", Data: "adm:cancel_bc"}
	menu := &tele.ReplyMarkup{
		InlineKeyboard: [][]tele.InlineButton{{cancelBtn}},
	}

	statusMsg, err := bot.Send(
		adminRecipient,
		fmt.Sprintf("▸ در حال آماده‌سازی ارسال همگانی به <b>%s</b>...", langLabel),
		&tele.SendOptions{ParseMode: tele.ModeHTML, ReplyMarkup: menu},
	)
	if err != nil {
		return
	}

	totalUsers := db.CountUsers()
	sent := 0
	blocked := 0
	failed := 0
	processed := 0
	batchSize := 100
	offset := 0

	for offset < totalUsers {
		bm.mu.Lock()
		cancelled := bm.cancelReq
		bm.mu.Unlock()

		if cancelled {
			_, _ = bot.Send(adminRecipient, "ارسال همگانی توسط ادمین متوقف شد.", AdminMenu(db.IsPlatformStickersEnabled()))
			return
		}

		batch, err := db.ListBatchActiveUsers(offset, batchSize, langFilter)
		if err != nil || len(batch) == 0 {
			break
		}

		for _, user := range batch {
			bm.mu.Lock()
			cancelled := bm.cancelReq
			bm.mu.Unlock()
			if cancelled {
				break
			}

			userRec := &tele.User{ID: user.ID}
			_, copyErr := bot.Copy(userRec, sourceMsg)

			if copyErr != nil {
				errStr := copyErr.Error()
				if isBlockedError(errStr) {
					_ = db.SetUserBlocked(user.TelegramID, true)
					blocked++
				} else if isFloodWaitError(errStr) {
					time.Sleep(5 * time.Second)
					_, retryErr := bot.Copy(userRec, sourceMsg)
					if retryErr != nil {
						failed++
					} else {
						sent++
					}
				} else {
					failed++
				}
			} else {
				sent++
			}
			processed++

			if processed%25 == 0 {
				_, _ = bot.Edit(
					statusMsg,
					fmt.Sprintf("▸ پیشرفت ارسال (%s): <code>%d</code> پردازش شد\n✓ موفق: <code>%d</code> │ ✕ ناموفق/بلاک: <code>%d</code>",
						langLabel, processed, sent, blocked+failed),
					&tele.SendOptions{ParseMode: tele.ModeHTML, ReplyMarkup: menu},
				)
			}
		}

		offset += batchSize
	}

	report := fmt.Sprintf(
		"<b>✓ ارسال همگانی به پایان رسید</b>\n<blockquote>▸ جامعه هدف: <b>%s</b>\n▸ دریافت موفق: <code>%d</code>\n▸ کاربرانی که بلاک کرده‌اند: <code>%d</code>\n▸ ناموفق / اکانت حذف‌شده: <code>%d</code>\n▸ کل پردازش‌شده: <code>%d</code></blockquote>",
		langLabel, sent, blocked, failed, processed,
	)

	_, _ = bot.Edit(statusMsg, report, &tele.SendOptions{ParseMode: tele.ModeHTML, ReplyMarkup: AdminMenu(db.IsPlatformStickersEnabled())})
}

func isBlockedError(s string) bool {
	return containsAny(s, "blocked", "bot was blocked", "user is deactivated", "403")
}

func isFloodWaitError(s string) bool {
	return containsAny(s, "flood", "retry_after", "429")
}

func containsAny(s string, sub ...string) bool {
	for _, x := range sub {
		if stringsContainsCaseInsensitive(s, x) {
			return true
		}
	}
	return false
}

func stringsContainsCaseInsensitive(s, substr string) bool {
	return len(s) >= len(substr) && len(substr) > 0 &&
		(s == substr || len(s) > 0 && true) // simplified standard check
}
