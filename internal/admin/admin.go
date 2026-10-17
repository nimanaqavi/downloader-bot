package admin

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	tele "gopkg.in/telebot.v3"

	"mimo/internal/config"
	"mimo/internal/database"
	"mimo/internal/downloader"
	"mimo/internal/utils"
)

func AdminMenu(stickersEnabled bool) *tele.ReplyMarkup {
	menu := &tele.ReplyMarkup{}

	btnStats := menu.Data("▸ آمار سیستم 📊", "adm:stats")
	btnUsers := menu.Data("▸ کاربران 👥", "adm:users:0")
	btnCache := menu.Data("▸ کش دانلود ⚡", "adm:cache")
	btnForceJoin := menu.Data("▸ جوین اجباری 📢", "adm:forcejoin")

	stickerLabel := "استیکر پلتفرم: روشن 🏷"
	if !stickersEnabled {
		stickerLabel = "استیکر پلتفرم: خاموش ⚪"
	}
	btnStickers := menu.Data(stickerLabel, "adm:toggle_stickers")
	btnLogs := menu.Data("▸ آخرین لاگ‌ها 📜", "adm:logs")

	btnBanned := menu.Data("▸ کاربران مسدود 🚫", "adm:banned")
	btnBroadcast := menu.Data("▸ ارسال همگانی ✉️", "adm:broadcast")

	menu.Inline(
		menu.Row(btnStats, btnUsers),
		menu.Row(btnCache, btnForceJoin),
		menu.Row(btnStickers, btnLogs),
		menu.Row(btnBanned, btnBroadcast),
	)
	return menu
}

func BackToAdmin() *tele.ReplyMarkup {
	menu := &tele.ReplyMarkup{}
	btnHome := menu.Data("بازگشت به پنل", "adm:home")
	menu.Inline(menu.Row(btnHome))
	return menu
}

func RegisterAdminHandlers(
	b *tele.Bot,
	cfg *config.Config,
	db *database.DB,
	bm *BroadcastManager,
	queue *downloader.Queue,
) {
	isAdmin := func(c tele.Context) bool {
		sender := c.Sender()
		if sender == nil {
			return false
		}
		return cfg.AdminUserIDs[sender.ID]
	}

	b.Handle("/admin", func(c tele.Context) error {
		if !isAdmin(c) {
			return nil
		}
		return c.Send("<b>پنل مدیریت ربات</b>", &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: AdminMenu(db.IsPlatformStickersEnabled()),
		})
	})

	b.Handle("/cancel", func(c tele.Context) error {
		if !isAdmin(c) {
			return nil
		}
		bm.CancelWaiting(c.Sender().ID)
		return c.Send("عملیات جاری ادمین لغو شد.", &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: AdminMenu(db.IsPlatformStickersEnabled()),
		})
	})

	b.Handle("/setchannel", func(c tele.Context) error {
		if !isAdmin(c) {
			return nil
		}
		args := c.Args()
		if len(args) == 0 {
			return c.Reply("لطفاً آیدی کانال را وارد کنید. مثال:\n<code>/setchannel @mychannel</code>", &tele.SendOptions{ParseMode: tele.ModeHTML})
		}
		ch := strings.TrimSpace(args[0])
		_ = db.SetForceJoinChannel(ch)
		return c.Reply(fmt.Sprintf("کانال جوین اجباری با موفقیت روی <code>%s</code> تنظیم شد.", utils.EscapeHTML(ch)), &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BackToAdmin(),
		})
	})

	b.Handle("/ban", func(c tele.Context) error {
		if !isAdmin(c) {
			return nil
		}
		args := c.Args()
		if len(args) == 0 {
			return c.Reply("شناسه تلگرام را وارد کنید: <code>/ban 12345678</code>", &tele.SendOptions{ParseMode: tele.ModeHTML})
		}
		tgID := strings.TrimSpace(args[0])
		_ = db.SetUserBannedByTelegramID(tgID, true)
		return c.Reply(fmt.Sprintf("کاربر با آیدی <code>%s</code> مسدود شد.", tgID), &tele.SendOptions{ParseMode: tele.ModeHTML})
	})

	b.Handle("/unban", func(c tele.Context) error {
		if !isAdmin(c) {
			return nil
		}
		args := c.Args()
		if len(args) == 0 {
			return c.Reply("شناسه تلگرام را وارد کنید: <code>/unban 12345678</code>", &tele.SendOptions{ParseMode: tele.ModeHTML})
		}
		tgID := strings.TrimSpace(args[0])
		_ = db.SetUserBannedByTelegramID(tgID, false)
		return c.Reply(fmt.Sprintf("کاربر با آیدی <code>%s</code> رفع مسدودیت شد.", tgID), &tele.SendOptions{ParseMode: tele.ModeHTML})
	})

	b.Handle("/setemoji", func(c tele.Context) error {
		if !isAdmin(c) {
			return nil
		}
		args := c.Args()
		if len(args) < 2 {
			currentList := ""
			for _, p := range []string{"youtube", "instagram", "tiktok", "spotify", "soundcloud", "x"} {
				id := db.GetPlatformEmojiID(p)
				icon := db.GetPlatformEmojiHTML(p)
				desc := "(پیش‌فرض)"
				if id != "" {
					desc = fmt.Sprintf("(ID: <code>%s</code>)", id)
				}
				currentList += fmt.Sprintf("• <b>%s</b>: %s %s\n", p, icon, desc)
			}
			return c.Reply(fmt.Sprintf(`<b>تنظیم Custom Emoji پلتفرم‌ها:</b>

روش استفاده:
<code>/setemoji &lt;platform&gt; &lt;شناسه عددی یا ایموجی&gt;</code>

پلتفرم‌های معتبر:
<code>youtube, instagram, tiktok, spotify, soundcloud, x</code>

<b>وضعیت فعلی:</b>
%s`, currentList), &tele.SendOptions{ParseMode: tele.ModeHTML})
		}

		platform := strings.ToLower(strings.TrimSpace(args[0]))
		emojiVal := strings.TrimSpace(args[1])
		_ = db.SetPlatformEmojiID(platform, emojiVal)

		rendered := db.GetPlatformEmojiHTML(platform)
		return c.Reply(fmt.Sprintf("✓ ایموجی پلتفرم <b>%s</b> با موفقیت تنظیم شد:\nنمایش: %s\nشناسه: <code>%s</code>", platform, rendered, emojiVal), &tele.SendOptions{ParseMode: tele.ModeHTML})
	})
}

func HandleAllAdminCallbacks(
	c tele.Context,
	data string,
	cfg *config.Config,
	db *database.DB,
	bm *BroadcastManager,
	queue *downloader.Queue,
) {
	sender := c.Sender()
	if sender == nil || !cfg.AdminUserIDs[sender.ID] {
		_ = c.Respond()
		return
	}

	switch {
	case data == "adm:home":
		bm.CancelWaiting(sender.ID)
		_ = c.Respond()
		_ = c.Edit("<b>پنل مدیریت ربات</b>", &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: AdminMenu(db.IsPlatformStickersEnabled()),
		})

	case data == "adm:toggle_stickers":
		current := db.IsPlatformStickersEnabled()
		_ = db.SetPlatformStickersEnabled(!current)
		alert := "ارسال استیکر پلتفرم روشن شد"
		if current {
			alert = "ارسال استیکر پلتفرم خاموش شد"
		}
		_ = c.Respond(&tele.CallbackResponse{Text: alert})
		_ = c.Edit("<b>پنل مدیریت ربات</b>", &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: AdminMenu(db.IsPlatformStickersEnabled()),
		})

	case data == "adm:stats":
		_ = c.Respond()
		stats, _ := db.GlobalStats()
		newToday := db.CountNewUsersToday()
		langStats, _ := db.CountByLanguage()
		cacheCount, cacheBytes, _ := db.CacheStats()
		waiting, active := queue.Stats()

		home := os.Getenv("HOME")
		usedDiskMB := utils.GetAccountUsedMB(home)
		maxDiskMB := cfg.MaxDiskBudgetMB
		diskPct := int((float64(usedDiskMB) / float64(maxDiskMB)) * 100)
		if diskPct > 100 {
			diskPct = 100
		}

		tikwmUsage := downloader.GetTikWMUsageCount()

		text := fmt.Sprintf(`<b>📊 آمار و وضعیت سیستم</b>

<b>⚡ منابع سرور (VPS 256MB):</b>
▸ دیسک مصرفی: <code>%s (%dMB / %dMB)</code>
▸ صف دانلود: <code>%d در انتظار │ %d فعال</code>

<b>👥 کاربران و دانلودها:</b>
▸ کل کاربران: <code>%d</code> (امروز: <code>%d</code>)
▸ تفکیک زبان: 🇮🇷 <code>%d</code> │ 🇬🇧 <code>%d</code> │ تعیین‌نشده: <code>%d</code>
▸ کل دانلودها: <code>%d</code> (امروز: <code>%d</code>)
▸ موفق: <code>%d</code> │ ناموفق: <code>%d</code>

<b>📦 ابزارها و کش:</b>
▸ مدیاهای کش‌شده: <code>%d</code> (حجم: <code>%s</code>)
▸ دانلودهای تیک‌تاک (TikWM): <code>%d</code> بار`,
			utils.RenderProgressBar(diskPct), usedDiskMB, maxDiskMB,
			waiting, active,
			stats.TotalUsers, newToday,
			langStats["fa"], langStats["en"], langStats["unset"],
			stats.TotalDownloads, stats.DownloadsToday,
			stats.SuccessfulDownloads, stats.FailedDownloads,
			cacheCount, utils.FormatBytes(cacheBytes, "fa"),
			tikwmUsage,
		)

		_ = c.Edit(text, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BackToAdmin(),
		})

	case data == "adm:cache":
		_ = c.Respond()
		count, bytes, _ := db.CacheStats()
		text := fmt.Sprintf(`<b>مدیریت کش دانلودها ⚡</b>
<blockquote>▸ تعداد رسانه‌های کش‌شده: <code>%d</code></blockquote>
<blockquote>▸ حجم کل صرفه‌جویی‌شده: <code>%s</code></blockquote>`,
			count, utils.FormatBytes(bytes, "fa"),
		)
		menu := &tele.ReplyMarkup{}
		btnClear := menu.Data("✕ پاک‌سازی کل کش", "adm:cache_clear")
		btnBack := menu.Data("بازگشت", "adm:home")
		menu.Inline(menu.Row(btnClear), menu.Row(btnBack))

		_ = c.Edit(text, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: menu,
		})

	case data == "adm:cache_clear":
		_ = db.ClearCache()
		_ = c.Respond(&tele.CallbackResponse{Text: "کش با موفقیت پاک شد."})
		_ = c.Edit("<b>کش با موفقیت پاک شد.</b>", &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BackToAdmin(),
		})

	case data == "adm:forcejoin":
		_ = c.Respond()
		isEnabled := db.IsForceJoinEnabled()
		channel := db.GetForceJoinChannel()
		if channel == "" {
			channel = "تنظیم‌نشده"
		}
		statusStr := "غیرفعال ❌"
		if isEnabled {
			statusStr = "فعال ✅"
		}
		text := fmt.Sprintf(`<b>📢 تنظیمات عضویت اجباری (Force Join)</b>
<blockquote>▸ وضعیت: <b>%s</b></blockquote>
<blockquote>▸ کانال هدف: <code>%s</code></blockquote>

برای تغییر کانال، دستور زیر را ارسال کنید:
<code>/setchannel @YourChannel</code>`,
			statusStr, utils.EscapeHTML(channel),
		)
		menu := &tele.ReplyMarkup{}
		toggleLabel := "🟢 فعال‌سازی"
		if isEnabled {
			toggleLabel = "🔴 غیرفعال‌سازی"
		}
		btnToggle := menu.Data(toggleLabel, "adm:fj_toggle")
		btnBack := menu.Data("بازگشت", "adm:home")
		menu.Inline(menu.Row(btnToggle), menu.Row(btnBack))

		_ = c.Edit(text, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: menu,
		})

	case data == "adm:fj_toggle":
		current := db.IsForceJoinEnabled()
		_ = db.SetForceJoinEnabled(!current)
		alert := "جوین اجباری فعال شد."
		if current {
			alert = "جوین اجباری غیرفعال شد."
		}
		_ = c.Respond(&tele.CallbackResponse{Text: alert})

		isEnabled := !current
		channel := db.GetForceJoinChannel()
		if channel == "" {
			channel = "تنظیم‌نشده"
		}
		statusStr := "غیرفعال ❌"
		if isEnabled {
			statusStr = "فعال ✅"
		}
		text := fmt.Sprintf(`<b>📢 تنظیمات عضویت اجباری (Force Join)</b>
<blockquote>▸ وضعیت: <b>%s</b></blockquote>
<blockquote>▸ کانال هدف: <code>%s</code></blockquote>

برای تغییر کانال، دستور زیر را ارسال کنید:
<code>/setchannel @YourChannel</code>`,
			statusStr, utils.EscapeHTML(channel),
		)
		menu := &tele.ReplyMarkup{}
		toggleLabel := "🟢 فعال‌سازی"
		if isEnabled {
			toggleLabel = "🔴 غیرفعال‌سازی"
		}
		btnToggle := menu.Data(toggleLabel, "adm:fj_toggle")
		btnBack := menu.Data("بازگشت", "adm:home")
		menu.Inline(menu.Row(btnToggle), menu.Row(btnBack))

		_ = c.Edit(text, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: menu,
		})

	case data == "adm:logs":
		_ = c.Respond()
		logText := "فایل لاگ یافت نشد."
		logPaths := []string{"/home/hermemssss/mimo/bot.log", "bot.log"}
		for _, p := range logPaths {
			if data, err := os.ReadFile(p); err == nil {
				lines := strings.Split(strings.TrimSpace(string(data)), "\n")
				if len(lines) > 20 {
					lines = lines[len(lines)-20:]
				}
				logText = strings.Join(lines, "\n")
				break
			}
		}
		sanitized := utils.SanitizeLog(logText, cfg.BotToken)
		if len(sanitized) > 3500 {
			sanitized = sanitized[len(sanitized)-3500:]
		}
		text := fmt.Sprintf("<b>📜 ۲۰ خط آخر لاگ سیستم (سانسور شده):</b>\n<pre><code>%s</code></pre>", utils.EscapeHTML(sanitized))
		_ = c.Edit(text, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BackToAdmin(),
		})

	case data == "adm:banned":
		_ = c.Respond()
		banned, _ := db.ListBannedUsers(10)
		if len(banned) == 0 {
			_ = c.Edit("<b>هیچ کاربری مسدود نیست.</b>", &tele.SendOptions{
				ParseMode:   tele.ModeHTML,
				ReplyMarkup: BackToAdmin(),
			})
			return
		}
		menu := &tele.ReplyMarkup{}
		var rows []tele.Row
		var listText []string
		for _, u := range banned {
			dName := u.TelegramID
			if u.Username != "" {
				dName = "@" + u.Username
			}
			listText = append(listText, fmt.Sprintf("• <b>%s</b> (<code>%s</code>)", dName, u.TelegramID))
			btn := menu.Data(fmt.Sprintf("رفع مسدودیت %s", dName), fmt.Sprintf("adm:ban:%d:0:0", u.ID))
			rows = append(rows, menu.Row(btn))
		}
		rows = append(rows, menu.Row(menu.Data("بازگشت", "adm:home")))
		menu.Inline(rows...)

		text := fmt.Sprintf("<b>🚫 لیست کاربران مسدودشده (۱۰ نفر اخیر):</b>\n%s\n\nبرای مسدود یا آن‌بن کردن دستی دستورات زیر را بفرستید:\n<code>/ban 123456789</code> یا <code>/unban 123456789</code>", strings.Join(listText, "\n"))
		_ = c.Edit(text, &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: menu,
		})

	case data == "adm:broadcast":
		_ = c.Respond()
		menu := &tele.ReplyMarkup{}
		btnAll := menu.Data("🌐 همه کاربران (All)", "adm:bc_target:all")
		btnFA := menu.Data("🇮🇷 فقط فارسی (Persian)", "adm:bc_target:fa")
		btnEN := menu.Data("🇬🇧 فقط انگلیسی (English)", "adm:bc_target:en")
		btnBack := menu.Data("بازگشت", "adm:home")
		menu.Inline(
			menu.Row(btnAll),
			menu.Row(btnFA),
			menu.Row(btnEN),
			menu.Row(btnBack),
		)
		_ = c.Edit("<b>ارسال پیام همگانی</b>\nجامعه هدف پیام را انتخاب کنید:", &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: menu,
		})

	case strings.HasPrefix(data, "adm:bc_target:"):
		target := strings.TrimPrefix(data, "adm:bc_target:")
		_ = c.Respond()
		_ = bm.Begin(sender.ID, target)
		label := "همه کاربران"
		if target == "fa" {
			label = "فقط فارسی"
		} else if target == "en" {
			label = "فقط انگلیسی"
		}
		_ = c.Edit(fmt.Sprintf("پیامی که می‌خواهید به <b>%s</b> ارسال شود را بفرستید.\nبرای انصراف /cancel بزنید.", label), &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: BackToAdmin(),
		})

	case data == "adm:cancel_bc":
		_ = c.Respond(&tele.CallbackResponse{Text: "درخواست لغو ارسال همگانی ثبت شد."})
		bm.RequestCancel()

	case strings.HasPrefix(data, "adm:users:"):
		pageStr := strings.TrimPrefix(data, "adm:users:")
		page, _ := strconv.Atoi(pageStr)
		_ = c.Respond()

		total := db.CountUsers()
		pageSize := 8
		pageCount := (total + pageSize - 1) / pageSize
		if pageCount < 1 {
			pageCount = 1
		}
		if page >= pageCount {
			page = pageCount - 1
		}

		users, _ := db.ListUsers(page, pageSize)
		menu := &tele.ReplyMarkup{}
		var rows []tele.Row

		for _, u := range users {
			dName := u.TelegramID
			if u.Username != "" {
				dName = "@" + u.Username
			}
			banPrefix := ""
			if u.IsBanned {
				banPrefix = "[مسدود] "
			}
			btn := menu.Data(fmt.Sprintf("%s%s (%d)", banPrefix, dName, u.TotalDownloads), fmt.Sprintf("adm:user:%d:0", u.ID))
			rows = append(rows, menu.Row(btn))
		}

		var nav []tele.Btn
		if page > 0 {
			nav = append(nav, menu.Data("قبلی", fmt.Sprintf("adm:users:%d", page-1)))
		}
		if page+1 < pageCount {
			nav = append(nav, menu.Data("بعدی", fmt.Sprintf("adm:users:%d", page+1)))
		}
		if len(nav) > 0 {
			rows = append(rows, nav)
		}
		rows = append(rows, menu.Row(menu.Data("بازگشت", "adm:home")))
		menu.Inline(rows...)

		_ = c.Edit(fmt.Sprintf("<b>لیست کاربران</b> (صفحه %d از %d):", page+1, pageCount), &tele.SendOptions{
			ParseMode:   tele.ModeHTML,
			ReplyMarkup: menu,
		})

	case strings.HasPrefix(data, "adm:user:"):
		parts := strings.Split(data, ":")
		if len(parts) >= 4 {
			userID, _ := strconv.ParseInt(parts[2], 10, 64)
			page, _ := strconv.Atoi(parts[3])
			_ = c.Respond()

			user, err := db.FindUserByID(userID)
			if err != nil || user == nil {
				_ = c.Edit("کاربر یافت نشد.", &tele.SendOptions{ReplyMarkup: BackToAdmin()})
				return
			}

			stats, _ := db.StatsForUser(userID)
			historyCount := db.CountDownloadsForUser(userID)
			historySize := 6
			pages := (historyCount + historySize - 1) / historySize
			if pages < 1 {
				pages = 1
			}
			if page >= pages {
				page = pages - 1
			}

			downloads, _ := db.ListDownloadsForUser(userID, page, historySize)
			historyText := "بدون دانلود."
			if len(downloads) > 0 {
				var items []string
				for _, dl := range downloads {
					statusIcon := "✕"
					if dl.Status == "success" {
						statusIcon = "✓"
					}
					items = append(items, fmt.Sprintf("%s │ %s\n<code>%s</code>", statusIcon, dl.CreatedAt, utils.EscapeHTML(dl.URL)))
				}
				historyText = strings.Join(items, "\n\n")
			}

			dName := user.TelegramID
			if user.Username != "" {
				dName = "@" + user.Username
			}
			banStatus := "فعال"
			if user.IsBanned {
				banStatus = "مسدود"
			}

			text := fmt.Sprintf(`<b>%s</b> (<code>%s</code>)
<blockquote>عضویت: %s</blockquote>
<blockquote>آخرین فعالیت: %s</blockquote>
<blockquote>دانلودها: کل <code>%d</code> │ امروز <code>%d</code></blockquote>
<blockquote>وضعیت: <b>%s</b></blockquote>
تاریخچه دانلود (صفحه %d از %d):
%s`,
				dName, user.TelegramID,
				user.FirstSeen,
				stats.LastActive,
				stats.TotalDownloads, stats.DownloadsToday,
				banStatus,
				page+1, pages,
				historyText,
			)

			menu := &tele.ReplyMarkup{}
			var rows []tele.Row

			var nav []tele.Btn
			if page > 0 {
				nav = append(nav, menu.Data("قبلی", fmt.Sprintf("adm:user:%d:%d", userID, page-1)))
			}
			if page+1 < pages {
				nav = append(nav, menu.Data("بعدی", fmt.Sprintf("adm:user:%d:%d", userID, page+1)))
			}

			banLabel := "مسدود کردن"
			banNext := 1
			if user.IsBanned {
				banLabel = "رفع مسدودیت"
				banNext = 0
			}
			rows = append(rows, menu.Row(menu.Data(banLabel, fmt.Sprintf("adm:ban:%d:%d:%d", userID, banNext, page))))
			if len(nav) > 0 {
				rows = append(rows, nav)
			}
			rows = append(rows, menu.Row(menu.Data("کاربران", "adm:users:0")))
			menu.Inline(rows...)

			_ = c.Edit(text, &tele.SendOptions{
				ParseMode:   tele.ModeHTML,
				ReplyMarkup: menu,
			})
		}

	case strings.HasPrefix(data, "adm:ban:"):
		parts := strings.Split(data, ":")
		if len(parts) >= 5 {
			userID, _ := strconv.ParseInt(parts[2], 10, 64)
			banVal := parts[3] == "1"
			page, _ := strconv.Atoi(parts[4])
			_ = c.Respond()

			_ = db.SetUserBanned(userID, banVal)
			user, _ := db.FindUserByID(userID)

			dName := strconv.FormatInt(userID, 10)
			if user != nil && user.Username != "" {
				dName = "@" + user.Username
			}

			actionStr := "رفع مسدودیت شد"
			if banVal {
				actionStr = "مسدود شد"
			}

			menu := &tele.ReplyMarkup{}
			btnUser := menu.Data("مشاهده کاربر", fmt.Sprintf("adm:user:%d:%d", userID, page))
			btnUsers := menu.Data("کاربران", "adm:users:0")
			menu.Inline(menu.Row(btnUser), menu.Row(btnUsers))

			_ = c.Edit(fmt.Sprintf("کاربر %s %s.", dName, actionStr), &tele.SendOptions{
				ParseMode:   tele.ModeHTML,
				ReplyMarkup: menu,
			})
		}

	default:
		_ = c.Respond()
	}
}
