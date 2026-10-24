package bot

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	tele "gopkg.in/telebot.v3"

	"mimo/internal/config"
	"mimo/internal/database"
	"mimo/internal/downloader"
	"mimo/internal/i18n"
	"mimo/internal/mtproto"
	"mimo/internal/utils"
)

type PendingSelection struct {
	UserID        int64                   `json:"user_id"`
	URL           string                  `json:"url"`
	URLNormalized string                  `json:"url_normalized"`
	PlatformName  string                  `json:"platform_name"`
	Platform      string                  `json:"platform"`
	Title         string                  `json:"title"`
	Author        string                  `json:"author"`
	Duration      float64                 `json:"duration"`
	StatusMsgID   int                     `json:"status_msg_id"`
	IsPhotoCard   bool                    `json:"is_photo_card"`
	Timestamp     int64                   `json:"timestamp"`
	Lang          string                  `json:"lang"`
	Quality       downloader.VideoQuality `json:"quality"`
}

type DownloadHandler struct {
	b                *tele.Bot
	cfg              *config.Config
	db               *database.DB
	dl               *downloader.Downloader
	queue            *downloader.Queue
	uploader         *mtproto.Uploader
	limiter          *utils.RateLimiter
	pendingLinks     map[int64]string
	pendingSelections map[string]*PendingSelection
	pendingReqs      map[string]string // reqID -> rawURL
	mu               sync.Mutex
}

func NewDownloadHandler(
	b *tele.Bot,
	cfg *config.Config,
	db *database.DB,
	dl *downloader.Downloader,
	queue *downloader.Queue,
	uploader *mtproto.Uploader,
	pendingLinks map[int64]string,
) *DownloadHandler {
	return &DownloadHandler{
		b:                b,
		cfg:              cfg,
		db:               db,
		dl:               dl,
		queue:            queue,
		uploader:         uploader,
		limiter:          utils.NewRateLimiter(cfg.RateLimitMax, cfg.RateLimitWindowSec),
		pendingLinks:     pendingLinks,
		pendingSelections: make(map[string]*PendingSelection),
		pendingReqs:      make(map[string]string),
	}
}

func (h *DownloadHandler) HandleLink(c tele.Context, rawURL string) {
	sender := c.Sender()
	if sender == nil {
		return
	}

	// 0. Language Check
	if !h.db.IsUserLanguageSet(sender.ID) {
		h.mu.Lock()
		h.pendingLinks[sender.ID] = rawURL
		h.mu.Unlock()

		_ = c.Send(i18n.Get("fa").ChooseLanguage, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BuildLanguageKeyboard(sender.LanguageCode),
		})
		return
	}

	userLang := h.db.GetUserLanguage(sender.ID)
	d := i18n.Get(userLang)

	// 1. Force Join Check
	if h.db.IsForceJoinEnabled() && !h.cfg.AdminUserIDs[sender.ID] {
		channel := h.db.GetForceJoinChannel()
		if channel != "" {
			chat, err := h.b.ChatByUsername(strings.TrimPrefix(channel, "@"))
			if err == nil && chat != nil {
				member, err := h.b.ChatMemberOf(chat, sender)
				if err != nil || member == nil || member.Role == tele.Left || member.Role == tele.Kicked {
					reqID := generateReqID()
					h.mu.Lock()
					h.pendingReqs[reqID] = rawURL
					h.mu.Unlock()

					menu := &tele.ReplyMarkup{}
					chClean := strings.TrimPrefix(channel, "@")
					btnJoin := menu.URL(d.BtnJoinChannel, fmt.Sprintf("https://t.me/%s", chClean))
					btnCheck := menu.Data(d.BtnCheckJoin, fmt.Sprintf("fj:check:%s", reqID))
					menu.Inline(menu.Row(btnJoin), menu.Row(btnCheck))

					_ = c.Send(d.ForceJoinPrompt, &tele.SendOptions{
						ParseMode:   tele.ModeHTML,
						ReplyMarkup: menu,
					})
					return
				}
			}
		}
	}

	// 2. Parse and validate media URL
	parsed := utils.ParseMediaURL(rawURL)
	if parsed == nil {
		_ = c.Send(d.ErrInvalidURL, &tele.SendOptions{ParseMode: tele.ModeHTML})
		return
	}

	// 3. Rate limiter
	rate := h.limiter.Consume(sender.ID)
	if !rate.Allowed {
		_ = c.Send(d.ErrRateLimit(rate.RetryAfterSeconds), &tele.SendOptions{ParseMode: tele.ModeHTML})
		return
	}

	// 4. SSRF Validation
	safe, err := utils.ValidateSafeURL(parsed.URL)
	if err != nil || !safe {
		_ = c.Send(d.ErrInvalidURL, &tele.SendOptions{ParseMode: tele.ModeHTML})
		return
	}

	urlNormalized := utils.NormalizeMediaURL(parsed.URL)

	// 5. Handle Spotify
	if parsed.Platform == "spotify" {
		h.handleSpotify(c, parsed, urlNormalized, userLang)
		return
	}

	// 6. Direct Audio Request (mp3 <url>)
	if parsed.IsAudioRequested {
		h.executePipeline(c, parsed.URL, urlNormalized, parsed.PlatformName, parsed.Platform, "", "", 0, downloader.QualityAudio, 0, userLang)
		return
	}

	// 7. Initial checking message
	statusMsg, err := h.b.Send(c.Recipient(), d.CheckingLink, &tele.SendOptions{ParseMode: tele.ModeHTML})
	if err != nil {
		return
	}

	// 8. Handle TikTok
	if parsed.Platform == "tiktok" {
		h.handleTikTok(c, parsed, urlNormalized, statusMsg.ID, userLang)
		return
	}

	// 9. Handle Instagram
	if parsed.Platform == "instagram" {
		h.handleInstagram(c, parsed, urlNormalized, statusMsg.ID, userLang)
		return
	}

	// 10. YouTube & Generic Platforms Quality Card
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	meta, err := h.dl.FetchMetadata(ctx, parsed.URL)
	if err != nil || meta == nil {
		meta = &downloader.Metadata{Title: parsed.PlatformName}
	}

	token := generateReqID()
	cardText := utils.BuildQualityCardText(utils.QualityCardOpts{
		Platform:          parsed.Platform,
		PlatformName:      parsed.PlatformName,
		PlatformEmojiHTML: h.db.GetPlatformEmojiHTML(parsed.Platform),
		Title:             meta.Title,
		DurationSeconds:   meta.Duration,
		ThumbnailURL:      meta.ThumbnailURL,
		Lang:              userLang,
	})

	keyboard := h.buildQualityKeyboard(token, parsed.Platform, urlNormalized, userLang)

	_, _ = h.b.Edit(statusMsg, cardText, &tele.SendOptions{
		ParseMode:             tele.ModeHTML,
		ReplyMarkup:           keyboard,
		DisableWebPagePreview: false,
	})

	pending := &PendingSelection{
		UserID:        sender.ID,
		URL:           parsed.URL,
		URLNormalized: urlNormalized,
		PlatformName:  parsed.PlatformName,
		Platform:      parsed.Platform,
		Title:         meta.Title,
		Author:        meta.Author,
		Duration:      meta.Duration,
		StatusMsgID:   statusMsg.ID,
		IsPhotoCard:   false,
		Timestamp:     time.Now().Unix(),
		Lang:          userLang,
	}

	h.mu.Lock()
	h.pendingSelections[token] = pending
	h.mu.Unlock()

	// Also persist to SQLite for persistence across restarts
	if data, err := json.Marshal(pending); err == nil {
		_ = h.db.SetSetting("pending:"+token, string(data))
	}
}

func (h *DownloadHandler) buildQualityKeyboard(
	token string,
	platform string,
	urlNormalized string,
	lang string,
) *tele.ReplyMarkup {
	menu := &tele.ReplyMarkup{}
	d := i18n.Get(lang)

	isYt := platform == "youtube"
	cancelBtn := menu.Data(d.BtnCancel, "cancel")

	if isYt {
		ref := token
		// Check if we can extract YouTube 11-char ID for stateless callbacks
		if strings.Contains(urlNormalized, "watch?v=") {
			parts := strings.Split(urlNormalized, "watch?v=")
			if len(parts) > 1 && len(parts[1]) >= 11 {
				ref = "y_" + parts[1][:11]
			}
		} else if strings.Contains(urlNormalized, "youtu.be/") {
			parts := strings.Split(urlNormalized, "youtu.be/")
			if len(parts) > 1 && len(parts[1]) >= 11 {
				ref = "y_" + parts[1][:11]
			}
		}

		p4k := ""
		if h.db.HasQualityCache(urlNormalized, "4k") {
			p4k = "⚡ "
		}
		p1080 := ""
		if h.db.HasQualityCache(urlNormalized, "1080p") {
			p1080 = "⚡ "
		}
		p720 := ""
		if h.db.HasQualityCache(urlNormalized, "720p") {
			p720 = "⚡ "
		}
		p480 := ""
		if h.db.HasQualityCache(urlNormalized, "480p") {
			p480 = "⚡ "
		}
		p360 := ""
		if h.db.HasQualityCache(urlNormalized, "360p") {
			p360 = "⚡ "
		}
		pAudio := ""
		if h.db.HasQualityCache(urlNormalized, "audio") {
			pAudio = "⚡ "
		}

		btn4K := menu.Data(p4k+"4K", fmt.Sprintf("q:%s:4k", ref))
		btn1080 := menu.Data(p1080+"1080p", fmt.Sprintf("q:%s:1080p", ref))
		btn720 := menu.Data(p720+"720p", fmt.Sprintf("q:%s:720p", ref))
		btn480 := menu.Data(p480+"480p", fmt.Sprintf("q:%s:480p", ref))
		btn360 := menu.Data(p360+"360p", fmt.Sprintf("q:%s:360p", ref))
		btnMP3 := menu.Data(pAudio+d.BtnGetMP3, fmt.Sprintf("q:%s:audio", ref))

		menu.Inline(
			menu.Row(btn4K, btn1080),
			menu.Row(btn720, btn480),
			menu.Row(btn360, btnMP3),
			menu.Row(cancelBtn),
		)
		return menu
	}

	pCompact := ""
	if h.db.HasQualityCache(urlNormalized, "compact") {
		pCompact = "⚡ "
	}
	pAudio := ""
	if h.db.HasQualityCache(urlNormalized, "audio") {
		pAudio = "⚡ "
	}

	btnDL := menu.Data(pCompact+d.BtnDownload, fmt.Sprintf("q:%s:compact", token))
	btnMP3 := menu.Data(pAudio+d.BtnGetMP3, fmt.Sprintf("q:%s:audio", token))

	menu.Inline(
		menu.Row(btnDL, btnMP3),
		menu.Row(cancelBtn),
	)
	return menu
}

func (h *DownloadHandler) handleTikTok(
	c tele.Context,
	media *utils.ParsedMediaURL,
	urlNormalized string,
	statusMsgID int,
	lang string,
) {
	// Check cache
	cached, err := h.db.FindCache(urlNormalized, "compact")
	if err == nil && cached != nil {
		h.deliverFromCache(c, cached, "TikTok", lang)
		_ = h.b.Delete(&tele.Message{ID: statusMsgID, Chat: c.Chat()})
		return
	}

	h.executePipeline(c, media.URL, urlNormalized, "TikTok", "tiktok", "", "", 0, downloader.QualityCompact, statusMsgID, lang)
}

func (h *DownloadHandler) handleInstagram(
	c tele.Context,
	media *utils.ParsedMediaURL,
	urlNormalized string,
	statusMsgID int,
	lang string,
) {
	// Check cache
	cached, err := h.db.FindCache(urlNormalized, "compact")
	if err == nil && cached != nil {
		h.deliverFromCache(c, cached, "Instagram", lang)
		_ = h.b.Delete(&tele.Message{ID: statusMsgID, Chat: c.Chat()})
		return
	}

	h.executePipeline(c, media.URL, urlNormalized, "Instagram", "instagram", "", "", 0, downloader.QualityCompact, statusMsgID, lang)
}

func (h *DownloadHandler) handleSpotify(
	c tele.Context,
	media *utils.ParsedMediaURL,
	urlNormalized string,
	lang string,
) {
	d := i18n.Get(lang)

	// Check cache
	cached, err := h.db.FindCache(urlNormalized, "audio")
	if err == nil && cached != nil {
		h.deliverFromCache(c, cached, "Spotify", lang)
		return
	}

	statusMsg, err := h.b.Send(c.Recipient(), d.CheckingLink, &tele.SendOptions{ParseMode: tele.ModeHTML})
	if err != nil {
		return
	}

	user, _ := h.db.GetOrCreateUser(c.Sender().ID, c.Sender().Username)
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Second)
	defer cancel()

	result, err := h.queue.Add(c.Sender().ID, func() (*downloader.DownloadResult, error) {
		return h.dl.ResolveAndDownloadSpotify(ctx, media.URL)
	})

	if err != nil {
		if user != nil {
			_, _ = h.db.CreateDownload(user.ID, media.URL, "failed", nil, "Spotify")
		}
		errorID := utils.GenerateErrorID()
		userErrorText := ""
		if errorsIs(err, downloader.ErrSpotifyUnsupported) {
			if lang == "en" {
				userErrorText = "<blockquote>⚠️ Albums, playlists and podcasts are not supported. Please send a single track link!</blockquote>"
			} else {
				userErrorText = "<blockquote>⚠️ لینک ارسالی مربوط به آلبوم، پلی‌لیست یا پادکست است. ربات در حال حاضر فقط از لینک تک‌آهنگ اسپاتیفای پشتیبانی می‌کند!</blockquote>"
			}
		} else if errorsIs(err, downloader.ErrSpotifyNotFound) {
			if lang == "en" {
				userErrorText = "<blockquote>⚠️ Track could not be found. Please check the song name or send a direct link!</blockquote>"
			} else {
				userErrorText = "<blockquote>⚠️ آهنگ مورد نظر در منابع صوتی یافت نشد. لطفاً نام آهنگ را بررسی کرده یا لینک مستقیم بفرستید!</blockquote>"
			}
		} else {
			userErrorText = utils.FriendlyDownloadError(err, errorID, lang)
		}

		_, _ = h.b.Edit(statusMsg, userErrorText, &tele.SendOptions{ParseMode: tele.ModeHTML})
		return
	}

	// Success
	caption := utils.BuildFinalCaption(utils.FinalCaptionOpts{
		Title:           result.Title,
		Author:          result.Author,
		DurationSeconds: result.DurationSeconds,
		FileSizeBytes:   result.FileSizeBytes,
		PlatformName:    "Spotify",
		PlatformEmoji:   h.db.GetPlatformEmojiHTML("spotify"),
		BotUsername:     h.cfg.BotUsername,
		IsAudio:         true,
		Lang:            lang,
	})

	h.sendPlatformStickerIfConfigured(c, "spotify")
	msgID, err := h.deliverMedia(c, result, caption, true, statusMsg, d)

	if user != nil {
		_, _ = h.db.CreateDownload(user.ID, media.URL, "success", &result.FileSizeBytes, "Spotify")
	}

	if err == nil && msgID > 0 {
		_ = h.db.SaveCache(database.CacheEntry{
			URLNormalized:   urlNormalized,
			Quality:         "audio",
			ChatID:          strconv.FormatInt(c.Chat().ID, 10),
			MessageID:       msgID,
			FileSizeBytes:   result.FileSizeBytes,
			MediaType:       "audio",
			Title:           result.Title,
			DurationSeconds: int(result.DurationSeconds),
		})
	}

	_ = h.b.Delete(statusMsg)
	if result.TempDirectory != "" {
		_ = os.RemoveAll(result.TempDirectory)
	}
}

func (h *DownloadHandler) deliverFromCache(
	c tele.Context,
	cached *database.CacheEntry,
	platformName string,
	lang string,
) {
	d := i18n.Get(lang)
	caption := utils.BuildFinalCaption(utils.FinalCaptionOpts{
		Title:           cached.Title,
		DurationSeconds: float64(cached.DurationSeconds),
		FileSizeBytes:   cached.FileSizeBytes,
		PlatformName:    platformName,
		PlatformEmoji:   h.db.GetPlatformEmojiHTML(strings.ToLower(platformName)),
		BotUsername:     h.cfg.BotUsername,
		IsAudio:         cached.MediaType == "audio",
		Lang:            lang,
	})

	h.sendPlatformStickerIfConfigured(c, platformName)

	copyPayload := map[string]any{
		"chat_id":      c.Chat().ID,
		"from_chat_id": cached.ChatID,
		"message_id":   cached.MessageID,
		"caption":      caption,
		"parse_mode":   "HTML",
	}
	_, err := h.b.Raw("copyMessage", copyPayload)
	if err != nil {
		// Cache entry was invalid/deleted in channel/chat, delete it
		_ = h.db.DeleteCache(cached.URLNormalized, cached.Quality)
		_ = c.Send(d.ErrRecordNotFound, &tele.SendOptions{ParseMode: tele.ModeHTML})
		return
	}

	user, _ := h.db.GetOrCreateUser(c.Sender().ID, c.Sender().Username)
	if user != nil {
		_, _ = h.db.CreateDownload(user.ID, cached.URLNormalized, "success", &cached.FileSizeBytes, platformName)
	}
}

func (h *DownloadHandler) executePipeline(
	c tele.Context,
	rawURL, urlNormalized, platformName, platformKey, title, author string,
	duration float64,
	quality downloader.VideoQuality,
	statusMsgID int,
	lang string,
) {
	d := i18n.Get(lang)
	var statusMsg *tele.Message

	if statusMsgID > 0 {
		statusMsg = &tele.Message{ID: statusMsgID, Chat: c.Chat()}
		// Immediately clear buttons and show starting progress to avoid duplicate clicks
		_, _ = h.b.Edit(statusMsg, d.CheckingLink, &tele.SendOptions{
			ParseMode:             tele.ModeHTML,
			DisableWebPagePreview: true,
		})
	} else {
		var err error
		statusMsg, err = h.b.Send(c.Recipient(), d.CheckingLink, &tele.SendOptions{ParseMode: tele.ModeHTML})
		if err != nil {
			return
		}
	}

	user, _ := h.db.GetOrCreateUser(c.Sender().ID, c.Sender().Username)
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(h.cfg.DownloadTimeoutSec)*time.Second)
	defer cancel()

	reportProgress := h.newProgressReporter(statusMsg, d)

	// Special Instagram multi-item handling
	if platformKey == "instagram" {
		postInfo, err := h.dl.ExtractInstagramMedia(ctx, rawURL)
		if err == nil && postInfo != nil && len(postInfo.Items) >= 1 {
			// Multi-slide Carousel
			total := len(postInfo.Items)
			if total > 10 {
				total = 10
			}
			_, _ = h.b.Edit(statusMsg, d.CarouselDetected(total), &tele.SendOptions{ParseMode: tele.ModeHTML})

			sentCount := 0
			var totalBytes int64

			for i := 0; i < total; i++ {
				item := postInfo.Items[i]
				itemRes, itemErr := h.queue.Add(c.Sender().ID, func() (*downloader.DownloadResult, error) {
					return h.dl.DownloadInstagramItem(ctx, item, reportProgress)
				})
				if itemErr != nil || itemRes == nil {
					continue
				}

				if sentCount == 0 {
					h.sendPlatformStickerIfConfigured(c, "instagram")
				}

				totalBytes += itemRes.FileSizeBytes
				caption := fmt.Sprintf("📸 %s\n🤖 @%s", d.CarouselItemTitle(i+1, total), h.cfg.BotUsername)
				if total == 1 && postInfo.Title != "" && postInfo.Title != "Instagram" {
					caption = fmt.Sprintf("📸 %s\n🤖 @%s", postInfo.Title, h.cfg.BotUsername)
				}
				_, _ = h.deliverMedia(c, itemRes, caption, itemRes.MediaType == "audio", statusMsg, d)

				if itemRes.TempDirectory != "" {
					_ = os.RemoveAll(itemRes.TempDirectory)
				}
				sentCount++
			}

			if sentCount > 0 {
				if user != nil {
					_, _ = h.db.CreateDownload(user.ID, rawURL, "success", &totalBytes, "Instagram")
				}
				_ = h.b.Delete(statusMsg)
				return
			}
		}
	}

	// Normal single-file pipeline via Queue
	result, err := h.queue.Add(c.Sender().ID, func() (*downloader.DownloadResult, error) {
		if platformKey == "tiktok" {
			return h.dl.DownloadTikTok(ctx, rawURL, reportProgress)
		}

		return h.dl.Download(ctx, rawURL, quality, reportProgress)
	})

	if err != nil {
		log.Printf("[download error] url=%s quality=%s err=%v", rawURL, quality, err)
		if !errors.Is(err, downloader.ErrActiveJob) && user != nil {
			_, _ = h.db.CreateDownload(user.ID, rawURL, "failed", nil, platformName)
		}
		errorID := utils.GenerateErrorID()
		friendly := utils.FriendlyDownloadError(err, errorID, lang)
		_, _ = h.b.Edit(statusMsg, friendly, &tele.SendOptions{
			ParseMode:             tele.ModeHTML,
			DisableWebPagePreview: true,
		})
		return
	}

	// Build Final Caption
	finalTitle := result.Title
	if finalTitle == "Media" && title != "" {
		finalTitle = title
	}
	finalAuthor := result.Author
	if finalAuthor == "" {
		finalAuthor = author
	}
	finalDuration := result.DurationSeconds
	if finalDuration == 0 {
		finalDuration = duration
	}

	isAudio := quality == downloader.QualityAudio || result.MediaType == "audio"
	caption := utils.BuildFinalCaption(utils.FinalCaptionOpts{
		Title:           finalTitle,
		Author:          finalAuthor,
		DurationSeconds: finalDuration,
		FileSizeBytes:   result.FileSizeBytes,
		PlatformName:    result.PlatformName,
		PlatformEmoji:   h.db.GetPlatformEmojiHTML(platformKey),
		BotUsername:     h.cfg.BotUsername,
		IsAudio:         isAudio,
		Lang:            lang,
	})

	h.sendPlatformStickerIfConfigured(c, platformKey)
	msgID, err := h.deliverMedia(c, result, caption, isAudio, statusMsg, d)

	var downloadID int64
	if err == nil {
		if user != nil {
			downloadID, _ = h.db.CreateDownload(user.ID, rawURL, "success", &result.FileSizeBytes, platformName)
		}
	} else {
		log.Printf("[deliver error] url=%s err=%v", rawURL, err)
		if user != nil {
			_, _ = h.db.CreateDownload(user.ID, rawURL, "failed", nil, platformName)
		}
		errorID := utils.GenerateErrorID()
		friendly := utils.FriendlyDownloadError(err, errorID, lang)
		_, _ = h.b.Send(c.Recipient(), friendly, &tele.SendOptions{
			ParseMode:             tele.ModeHTML,
			DisableWebPagePreview: true,
		})
	}

	if err == nil && msgID > 0 {
		_ = h.db.SaveCache(database.CacheEntry{
			URLNormalized:   urlNormalized,
			Quality:         string(quality),
			ChatID:          strconv.FormatInt(c.Chat().ID, 10),
			MessageID:       msgID,
			FileSizeBytes:   result.FileSizeBytes,
			MediaType:       result.MediaType,
			Title:           finalTitle,
			DurationSeconds: int(finalDuration),
		})

		// If video was sent, add [ 🎵 دریافت MP3 ] button under the media message
		if !isAudio && downloadID > 0 {
			menu := &tele.ReplyMarkup{}
			btnMP3 := menu.Data(d.BtnGetMP3, fmt.Sprintf("mp3:%d", downloadID))
			menu.Inline(menu.Row(btnMP3))
			_, _ = h.b.EditReplyMarkup(&tele.Message{ID: msgID, Chat: c.Chat()}, menu)
		}
	}

	_ = h.b.Delete(statusMsg)
	if result.TempDirectory != "" {
		_ = os.RemoveAll(result.TempDirectory)
	}
}

// newProgressReporter returns a callback that edits the status message at most
// once per second, and also whenever the percentage has moved 5 points. A tiny
// file finishes in well under a second, so a time-only throttle would leave the
// bar sitting at the first percentage it happened to report.
func (h *DownloadHandler) newProgressReporter(statusMsg *tele.Message, d *i18n.Dictionary) downloader.ProgressCallback {
	var mu sync.Mutex
	lastEdit := time.Now()
	lastPct := -1

	return func(pct int) {
		mu.Lock()
		defer mu.Unlock()

		if pct <= lastPct {
			return
		}
		due := time.Since(lastEdit) >= time.Second || pct-lastPct >= 5 || pct == 100
		if !due {
			return
		}

		lastEdit = time.Now()
		lastPct = pct
		_, _ = h.b.Edit(statusMsg, d.DownloadingProgress(utils.RenderProgressBar(pct)), &tele.SendOptions{
			ParseMode:             tele.ModeHTML,
			DisableWebPagePreview: true,
		})
	}
}

func (h *DownloadHandler) deliverMedia(
	c tele.Context,
	result *downloader.DownloadResult,
	caption string,
	isAudio bool,
	statusMsg *tele.Message,
	d *i18n.Dictionary,
) (int, error) {
	const telegrafMediaLimitBytes = 45 * 1024 * 1024
	const telegrafPhotoLimitBytes = 10 * 1024 * 1024

	// Fast-path: HTTP stream via Bot API for files <= 45MB (photos <= 10MB)
	if (result.MediaType == "photo" && result.FileSizeBytes <= telegrafPhotoLimitBytes) ||
		(result.MediaType != "photo" && result.FileSizeBytes <= telegrafMediaLimitBytes) {

		if result.MediaType == "photo" {
			photo := &tele.Photo{
				File:    tele.FromDisk(result.MediaPath),
				Caption: caption,
			}
			msg, err := h.b.Send(c.Recipient(), photo, &tele.SendOptions{ParseMode: tele.ModeHTML})
			if err != nil {
				return 0, err
			}
			return msg.ID, nil
		}

		if isAudio {
			audio := &tele.Audio{
				File:      tele.FromDisk(result.MediaPath),
				Caption:   caption,
				Title:     result.Title,
				Performer: result.Author,
				Duration:  int(result.DurationSeconds),
			}
			msg, err := h.b.Send(c.Recipient(), audio, &tele.SendOptions{ParseMode: tele.ModeHTML})
			if err != nil {
				return 0, err
			}
			return msg.ID, nil
		}

		video := &tele.Video{
			File:      tele.FromDisk(result.MediaPath),
			Caption:   caption,
			Duration:  int(result.DurationSeconds),
			Width:     result.Width,
			Height:    result.Height,
			MIME:      "video/mp4",
			Streaming: true,
		}
		msg, err := h.b.Send(c.Recipient(), video, &tele.SendOptions{ParseMode: tele.ModeHTML})
		if err != nil {
			return 0, err
		}
		return msg.ID, nil
	}

	// Lazy MTProto upload for files > 45MB
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Upload progress: same throttle as the download bar (1 s or 5 points).
	var mu sync.Mutex
	lastPct := -1
	lastEdit := time.Now()
	onUpload := func(pct int) {
		mu.Lock()
		defer mu.Unlock()
		if pct <= lastPct || statusMsg == nil {
			return
		}
		if pct < 100 && pct-lastPct < 5 && time.Since(lastEdit) < time.Second {
			return
		}
		lastPct = pct
		lastEdit = time.Now()
		_, _ = h.b.Edit(statusMsg, d.UploadingProgress(utils.RenderProgressBar(pct)), &tele.SendOptions{
			ParseMode:             tele.ModeHTML,
			DisableWebPagePreview: true,
		})
	}

	msgID, err := h.uploader.UploadLargeFile(ctx, c.Chat().ID, result.MediaPath, caption, isAudio, onUpload)
	return msgID, err
}

func (h *DownloadHandler) sendPlatformStickerIfConfigured(c tele.Context, platform string) {
	if !h.db.IsPlatformStickersEnabled() {
		return
	}
	stickerID := h.db.GetPlatformSticker(platform)
	if stickerID != "" {
		sticker := &tele.Sticker{File: tele.File{FileID: stickerID}}
		_, _ = h.b.Send(c.Recipient(), sticker)
	}
}

func (h *DownloadHandler) consumePendingReq(reqID string) (string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	rawURL, ok := h.pendingReqs[reqID]
	delete(h.pendingReqs, reqID)
	return rawURL, ok
}

func (h *DownloadHandler) getPendingSelection(ref string) *PendingSelection {
	h.mu.Lock()
	defer h.mu.Unlock()
	pending, ok := h.pendingSelections[ref]
	if ok {
		delete(h.pendingSelections, ref)
		return pending
	}
	return nil
}

func generateReqID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func errorsIs(err, target error) bool {
	if err == nil || target == nil {
		return err == target
	}
	return strings.Contains(err.Error(), target.Error())
}
