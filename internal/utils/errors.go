package utils

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"mimo/internal/i18n"
)

var (
	botTokenRegex   = regexp.MustCompile(`bot\d+:[A-Za-z0-9_-]+`)
	genericTokenReg = regexp.MustCompile(`\d{8,11}:[A-Za-z0-9_-]{30,50}`)
)

func GenerateErrorID() string {
	b := make([]byte, 3)
	rand.Read(b)
	return "ERR-" + strings.ToUpper(hex.EncodeToString(b))
}

func SanitizeLog(text string, tokenToMask string) string {
	if text == "" {
		return ""
	}
	s := botTokenRegex.ReplaceAllString(text, "bot[REDACTED_TOKEN]")
	s = genericTokenReg.ReplaceAllString(s, "[REDACTED_TOKEN]")
	if tokenToMask != "" {
		s = strings.ReplaceAll(s, tokenToMask, "[REDACTED_TOKEN]")
	}
	return s
}

func FriendlyDownloadError(err error, errorID string, lang string) string {
	if errorID == "" {
		errorID = GenerateErrorID()
	}
	if lang == "" {
		lang = "fa"
	}
	d := i18n.Get(lang)

	if err == nil {
		return d.ErrGeneric(errorID)
	}

	msg := err.Error()
	lower := strings.ToLower(msg)

	if strings.Contains(msg, "سقف") || strings.Contains(msg, "بیشتر از سقف") || strings.Contains(msg, "فضای خالی") {
		label := "کد پیگیری"
		if lang == "en" {
			label = "Error ID"
		}
		return fmt.Sprintf("%s\n<code>%s: %s</code>", msg, label, errorID)
	}

	if strings.Contains(lower, "max-filesize") || strings.Contains(lower, "file is larger") {
		return d.ErrMaxSize(errorID)
	}

	if strings.Contains(lower, "too large") || strings.Contains(lower, "413") {
		if lang == "en" {
			return fmt.Sprintf("⚠️ This video exceeds Telegram's 50MB Bot limit. To upload files up to 2GB, please configure TELEGRAM_API_ID & TELEGRAM_API_HASH on the server, or download 360p instead.\n<code>Error ID: %s</code>", errorID)
		}
		return fmt.Sprintf("⚠️ حجم این ویدیو بیش از ۵۰ مگابایت است. ارسال فایل‌های بالای ۵۰ مگابایت (تا ۲ گیگابایت) در تلگرام نیازمند تنظیم TELEGRAM_API_ID و TELEGRAM_API_HASH در سرور است. لطفاً کیفیت 360p را انتخاب فرمایید.\n<code>کد پیگیری: %s</code>", errorID)
	}

	if strings.Contains(lower, "duration") || strings.Contains(lower, "longer than") || strings.Contains(lower, "does not pass filter") {
		return d.ErrMaxDuration(errorID)
	}

	if strings.Contains(lower, "spotify") || strings.Contains(lower, "drm") {
		return d.ErrSpotifyDRM
	}

	if strings.Contains(lower, "login required") || strings.Contains(lower, "checkpoint") ||
		strings.Contains(lower, "following this account") || strings.Contains(lower, "private account") {
		return d.ErrInstagramPrivate(errorID)
	}

	if strings.Contains(lower, "sign in") || strings.Contains(lower, "bot") {
		return d.ErrSourceBlocked(errorID)
	}

	if strings.Contains(lower, "timeout") || strings.Contains(lower, "timed out") {
		return d.ErrTimeout(errorID)
	}

	if strings.Contains(lower, "private") || strings.Contains(lower, "members-only") {
		return d.ErrPrivateMedia(errorID)
	}

	if strings.Contains(lower, "tiktok") {
		return d.ErrTikTok(errorID)
	}

	if strings.Contains(msg, "یک دانلود در حال پردازش") {
		return d.ErrActiveJob
	}

	return d.ErrGeneric(errorID)
}
