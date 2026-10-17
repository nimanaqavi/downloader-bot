package bot

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"

	tele "gopkg.in/telebot.v3"

	"mimo/internal/admin"
	"mimo/internal/downloader"
	"mimo/internal/i18n"
	"mimo/internal/utils"
)

func CleanCallbackData(raw string) string {
	raw = strings.TrimPrefix(raw, "\f")
	raw = strings.TrimSuffix(raw, "|")
	if idx := strings.Index(raw, "|"); idx != -1 {
		unique := raw[:idx]
		payload := raw[idx+1:]
		if payload != "" {
			raw = unique + ":" + payload
		} else {
			raw = unique
		}
	}
	return strings.TrimSpace(raw)
}

func (s *BotServer) RegisterMasterCallback(dlHandler *DownloadHandler) {
	s.Bot.Handle(tele.OnCallback, func(c tele.Context) error {
		cb := c.Callback()
		if cb == nil {
			return nil
		}

		sender := c.Sender()
		if sender == nil {
			_ = c.Respond()
			return nil
		}

		data := CleanCallbackData(cb.Data)
		log.Printf("[callback] sender=%d data=%q raw=%q", sender.ID, data, cb.Data)

		userLang := s.DB.GetUserLanguage(sender.ID)
		d := i18n.Get(userLang)

		// 1. Language Callbacks: set_lang:fa | set_lang:en
		if strings.HasPrefix(data, "set_lang:") {
			lang := strings.TrimPrefix(data, "set_lang:")
			if lang != "fa" && lang != "en" {
				lang = "fa"
			}
			_ = s.DB.SetUserLanguage(sender.ID, lang)
			_ = c.Respond(&tele.CallbackResponse{
				Text:      i18n.Get(lang).LangChanged,
				ShowAlert: true,
			})
			_ = c.Edit(i18n.Get(lang).Start, &tele.SendOptions{
				ParseMode: tele.ModeHTML,
			})

			s.mu.Lock()
			pendingURL, ok := s.pendingLinks[sender.ID]
			delete(s.pendingLinks, sender.ID)
			s.mu.Unlock()

			if ok && pendingURL != "" {
				dlHandler.HandleLink(c, pendingURL)
			}
			return nil
		}

		// 2. History Callbacks: hist:menu | hist:back | hist:instagram | hist:youtube | hist:tiktok | hist:all
		if strings.HasPrefix(data, "hist:") {
			sub := strings.TrimPrefix(data, "hist:")
			_ = c.Respond()

			if sub == "menu" || sub == "back" {
				return c.Edit(d.HistoryTitle, &tele.SendOptions{
					ParseMode:   tele.ModeHTML,
					ReplyMarkup: HistoryKeyboard(userLang),
				})
			}

			platformKey := sub
			platformLabel := "همه پلتفرم‌ها"
			if userLang == "en" {
				platformLabel = "All Platforms"
			}

			switch platformKey {
			case "instagram":
				platformLabel = "اینستاگرام"
				if userLang == "en" {
					platformLabel = "Instagram"
				}
			case "youtube":
				platformLabel = "یوتیوب"
				if userLang == "en" {
					platformLabel = "YouTube"
				}
			case "tiktok":
				platformLabel = "تیک‌تاک"
				if userLang == "en" {
					platformLabel = "TikTok"
				}
			}

			user, err := s.DB.GetOrCreateUser(sender.ID, sender.Username)
			if err != nil {
				return nil
			}

			rows, _ := s.DB.ListDownloadsForUserByPlatform(user.ID, platformKey, 5)

			menu := &tele.ReplyMarkup{}
			btnBack := menu.Data(d.BtnBack, "hist:menu")
			menu.Inline(menu.Row(btnBack))

			platformEmoji := s.DB.GetPlatformEmojiHTML(platformKey)
			fullHeader := fmt.Sprintf("%s %s", platformEmoji, platformLabel)

			if len(rows) == 0 {
				return c.Edit(d.HistoryEmpty(fullHeader), &tele.SendOptions{
					ParseMode:   tele.ModeHTML,
					ReplyMarkup: menu,
				})
			}

			var items []string
			for i, r := range rows {
				dateStr := r.CreatedAt
				if len(dateStr) >= 16 {
					dateStr = strings.Replace(dateStr[:16], "T", " ", 1)
				}
				items = append(items, fmt.Sprintf("%d. <b>%s</b>\n<code>%s</code>", i+1, dateStr, utils.EscapeHTML(r.URL)))
			}

			text := fmt.Sprintf("%s\n\n%s", d.HistoryRecent(fullHeader), strings.Join(items, "\n\n"))
			return c.Edit(text, &tele.SendOptions{
				ParseMode:   tele.ModeHTML,
				ReplyMarkup: menu,
			})
		}

		// 3. Cancel Callback: cancel | cancel:<token>
		if data == "cancel" || strings.HasPrefix(data, "cancel:") {
			_ = c.Respond()
			return c.Delete()
		}

		// 4. Force Join Check: fj:check:<reqID>
		if strings.HasPrefix(data, "fj:check:") {
			reqID := strings.TrimPrefix(data, "fj:check:")
			_ = c.Respond()

			rawURL, ok := dlHandler.consumePendingReq(reqID)
			if !ok {
				return c.Edit(d.ErrSessionExpired, &tele.SendOptions{ParseMode: tele.ModeHTML})
			}

			channel := s.DB.GetForceJoinChannel()
			chat, err := s.Bot.ChatByUsername(strings.TrimPrefix(channel, "@"))
			if err == nil && chat != nil {
				member, err := s.Bot.ChatMemberOf(chat, sender)
				if err == nil && member != nil && member.Role != tele.Left && member.Role != tele.Kicked {
					_ = c.Delete()
					dlHandler.HandleLink(c, rawURL)
					return nil
				}
			}

			_ = c.Respond(&tele.CallbackResponse{
				Text:      d.ForceJoinNotYet,
				ShowAlert: true,
			})
			return nil
		}

		// 5. Quality Selection Callbacks: q:<ref>:<quality> or dl:<ref>:<quality>
		if strings.HasPrefix(data, "q:") || strings.HasPrefix(data, "dl:") {
			_ = c.Respond()
			parts := strings.Split(data, ":")
			if len(parts) >= 3 {
				ref := parts[1]
				quality := downloader.VideoQuality(parts[2])

				// Stateless YouTube resolution: ref starts with y_
				if strings.HasPrefix(ref, "y_") && len(ref) == 13 {
					videoID := ref[2:]
					ytURL := fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID)
					_ = c.Delete()
					dlHandler.executePipeline(c, ytURL, ytURL, "YouTube", "youtube", "", "", 0, quality, 0, userLang)
					return nil
				}

				// Persisted pending selection fallback
				pending := dlHandler.getPendingSelection(ref)
				if pending == nil {
					persisted := s.DB.GetSetting("pending:" + ref)
					if persisted != "" {
						var p PendingSelection
						if err := json.Unmarshal([]byte(persisted), &p); err == nil {
							pending = &p
						}
					}
				}

				if pending == nil {
					return c.Edit(d.ErrSessionExpired, &tele.SendOptions{ParseMode: tele.ModeHTML})
				}

				if pending.UserID != sender.ID {
					return nil
				}

				statusMsgID := pending.StatusMsgID
				if pending.IsPhotoCard {
					_ = c.Delete()
					statusMsgID = 0
				}

				dlHandler.executePipeline(
					c,
					pending.URL,
					pending.URLNormalized,
					pending.PlatformName,
					pending.Platform,
					pending.Title,
					pending.Author,
					pending.Duration,
					quality,
					statusMsgID,
					pending.Lang,
				)
				return nil
			}
		}

		// 6. MP3 Button under delivered videos: mp3:<downloadId>
		if strings.HasPrefix(data, "mp3:") {
			dlIDStr := strings.TrimPrefix(data, "mp3:")
			dlID, err := strconv.ParseInt(dlIDStr, 10, 64)
			_ = c.Respond()
			if err != nil {
				return nil
			}

			rawURL, platform, err := s.DB.FindDownloadURLByID(dlID)
			if err != nil || rawURL == "" {
				return c.Send(d.ErrRecordNotFound, &tele.SendOptions{ParseMode: tele.ModeHTML})
			}

			urlNormalized := utils.NormalizeMediaURL(rawURL)
			dlHandler.executePipeline(c, rawURL, urlNormalized, platform, strings.ToLower(platform), "", "", 0, downloader.QualityAudio, 0, userLang)
			return nil
		}

		// 7. Admin Callbacks: adm:*
		if strings.HasPrefix(data, "adm:") {
			if s.Config.AdminUserIDs[sender.ID] {
				admin.HandleAllAdminCallbacks(c, data, s.Config, s.DB, s.BroadcastMgr, s.Queue)
				return nil
			}
			_ = c.Respond()
			return nil
		}

		// Default: always acknowledge callback so button stops loading
		_ = c.Respond()
		return nil
	})
}
