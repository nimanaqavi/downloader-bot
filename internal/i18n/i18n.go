package i18n

import (
	"fmt"
	"strings"
)

type Language = string

const (
	LangFA Language = "fa"
	LangEN Language = "en"
)

func Isolate(text string) string {
	if text == "" {
		return ""
	}
	return "⁨" + text + "⁩"
}

type Dictionary struct {
	Start                  string
	Help                   func(botUsername string) string
	ChooseLanguage         string
	LangChanged            string
	BtnFA                  string
	BtnEN                  string
	CheckingLink           string
	CachedInstant          string
	QueueWaiting           func(pos int) string
	DownloadingProgress    func(bar string) string
	UploadingProgress      func(bar string) string
	ServerBusyFlood        func(sec int) string
	CarouselDetected       func(total int) string
	CarouselItemTitle      func(current, total int) string
	SourceLabel            string
	DurationLabel          string
	SizeLabel              string
	ArtistLabel            func(artist string) string
	BtnDownload            string
	BtnCancel              string
	BtnGetMP3              string
	BtnCheckJoin           string
	BtnJoinChannel         string
	ForceJoinPrompt        string
	ForceJoinNotYet        string
	ForceJoinConfirmed     string
	HistoryTitle           string
	HistoryEmpty           func(platform string) string
	HistoryRecent          func(platform string) string
	BtnBack                string
	HistBtnInstagram       string
	HistBtnYouTube         string
	HistBtnTikTok          string
	HistBtnAll             string
	ErrInvalidURL          string
	ErrRateLimit           func(sec int) string
	ErrActiveJob           string
	ErrSessionExpired      string
	ErrRecordNotFound      string
	ErrMaxSize             func(errorID string) string
	ErrMaxDuration         func(errorID string) string
	ErrSpotifyDRM          string
	ErrInstagramPrivate    func(errorID string) string
	ErrSourceBlocked       func(errorID string) string
	ErrTimeout             func(errorID string) string
	ErrPrivateMedia        func(errorID string) string
	ErrTikTok              func(errorID string) string
	ErrQualityNotAvailable func(req string, avail []string) string
	ErrGeneric             func(errorID string) string
}

var Translations = map[Language]*Dictionary{
	LangFA: {
		Start: "👋 سلام! به میمو خوش اومدی.\nلینک ویدیو، آهنگ یا عکس رو بفرست تا برات بگیرم. راهنما: /help",
		Help: func(botUsername string) string {
			return fmt.Sprintf("📖 راهنما\n۱. لینک رو کپی کن.\n۲. توی چت بفرست.\n۳. فایل رو تحویل بگیر.\n📜 تاریخچه: /history │ 🌐 زبان: /language\n🤖 @%s", botUsername)
		},
		ChooseLanguage: "<b>زبان خود را انتخاب کنید / Choose your language:</b>",
		LangChanged:    "زبان با موفقیت تغییر کرد ✓",
		BtnFA:          "فارسی 🇮🇷",
		BtnEN:          "English 🇬🇧",
		CheckingLink:   "▸ در حال بررسی لینک... ⏳",
		CachedInstant:  "⚡ در حال ارسال فوری از کش...",
		QueueWaiting: func(pos int) string {
			return fmt.Sprintf("⏳ در نوبت دانلود (نفر <code>%d</code>)...", pos)
		},
		DownloadingProgress: func(bar string) string {
			return fmt.Sprintf("▸ در حال دانلود... ⚡\n<code>%s</code>", bar)
		},
		UploadingProgress: func(bar string) string {
			return fmt.Sprintf("▸ در حال آپلود... 📤\n<code>%s</code>", bar)
		},
		ServerBusyFlood: func(sec int) string {
			return fmt.Sprintf("⏳ سرور شلوغه، چند لحظه صبر کن (%ds)...", sec)
		},
		CarouselDetected: func(total int) string {
			return fmt.Sprintf("📸 آلبوم اینستاگرام شامل <code>%d</code> آیتم شناسایی شد.\nدر حال دریافت و ارسال تک‌تک... ⏳", total)
		},
		CarouselItemTitle: func(current, total int) string {
			return fmt.Sprintf("اینستاگرام (آیتم %d از %d)", current, total)
		},
		SourceLabel:   "منبع",
		DurationLabel: "مدت",
		SizeLabel:     "حجم",
		ArtistLabel: func(artist string) string {
			return fmt.Sprintf("👤 خواننده: %s", artist)
		},
		BtnDownload:        "دانلود",
		BtnCancel:          "✕ لغو",
		BtnGetMP3:          "🎵 دریافت MP3",
		BtnCheckJoin:       "بررسی عضویت ✓",
		BtnJoinChannel:     "🔗 عضویت در کانال",
		ForceJoinPrompt:    "<b>📢 عضویت در کانال الزامی است</b>\n\n<blockquote>جهت استفاده از ربات و دریافت فایل، لطفاً ابتدا در کانال زیر عضو شوید، سپس روی دکمه «بررسی عضویت ✓» بزنید:</blockquote>",
		ForceJoinNotYet:    "⚠️ هنوز در کانال عضو نشده‌اید! لطفاً ابتدا عضو شوید.",
		ForceJoinConfirmed: "✓ عضویت شما تأیید شد. لطفاً لینک را دوباره ارسال کنید.",
		HistoryTitle:       "<b>📜 تاریخچه دانلودهای شما</b>\nپلتفرم مورد نظر را برای مشاهده ۵ دانلود اخیر انتخاب کنید:",
		HistoryEmpty: func(platform string) string {
			return fmt.Sprintf("<b>📜 تاریخچه (%s)</b>\nهنوز دانلودی در این بخش ثبت نشده است.", platform)
		},
		HistoryRecent: func(platform string) string {
			return fmt.Sprintf("<b>📜 ۵ دانلود اخیر (%s):</b>", platform)
		},
		BtnBack:             "🔙 بازگشت",
		HistBtnInstagram:    "📸 اینستاگرام",
		HistBtnYouTube:      "▶️ یوتیوب",
		HistBtnTikTok:       "🎶 تیک‌تاک",
		HistBtnAll:          "🌐 همه دانلودها",
		ErrInvalidURL:       "<b>✕ خطا:</b> لینک ارسالی نامعتبر است.\nلطفاً یک لینک معتبر اینترنتی ارسال کنید.",
		ErrRateLimit: func(sec int) string {
			return fmt.Sprintf("⏳ لطفاً پس از <code>%d</code> ثانیه دوباره تلاش کنید.", sec)
		},
		ErrActiveJob:      "شما هم‌اکنون یک دانلود در حال پردازش در صف دارید. لطفاً تا پایان آن صبر کنید.",
		ErrSessionExpired: "⏳ نشست منقضی شده است. لطفاً لینک را دوباره ارسال کنید.",
		ErrRecordNotFound: "✕ رکورد دانلود یافت نشد.",
		ErrMaxSize: func(errorID string) string {
			return fmt.Sprintf("حجم این فایل بیشتر از سقف مجاز سرور است. لطفاً کیفیت پایین‌تر یا نسخه صوتی را انتخاب کنید.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrMaxDuration: func(errorID string) string {
			return fmt.Sprintf("مدت زمان این ویدیو بیشتر از حد مجاز است یا در حال پخش زنده (Live) می‌باشد.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrSpotifyDRM: "<blockquote>⚠️ آهنگ‌های مستقیم اسپاتیفای قفل هستند و نمیشه مستقیم دانلودشون کرد. لطفاً اسم آهنگ یا لینکش از یوتیوب/ساندکلاد رو بفرست تا فوری تحویل بدم!</blockquote>",
		ErrInstagramPrivate: func(errorID string) string {
			return fmt.Sprintf("این پست اینستاگرام خصوصی (Private) است یا نیاز به ورود به حساب دارد.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrSourceBlocked: func(errorID string) string {
			return fmt.Sprintf("ارتباط با سرور مبدأ موقتاً محدود شده است. لطفاً چند دقیقه دیگر امتحان کنید.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrTimeout: func(errorID string) string {
			return fmt.Sprintf("زمان دانلود طولانی شد و متوقف گردید. لطفاً مجدداً امتحان کنید.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrPrivateMedia: func(errorID string) string {
			return fmt.Sprintf("این ویدیو خصوصی یا مخصوص اعضا است و امکان دانلود آن وجود ندارد.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrTikTok: func(errorID string) string {
			return fmt.Sprintf("ارتباط با سرور تیک‌تاک برقرار نشد. لطفاً چند لحظه بعد مجدداً امتحان کنید.\n<code>کد پیگیری: %s</code>", errorID)
		},
		ErrQualityNotAvailable: func(req string, avail []string) string {
			availList := strings.Join(avail, ", ")
			if availList != "" {
				availList += ", MP3"
			} else {
				availList = "MP3"
			}
			return fmt.Sprintf("⚠️ کیفیت مورد نظر ویدیو شما (<b>%s</b>) در دسترس نیست.\n✅ کیفیت‌های در دسترس برای این ویدیو:\n<code>%s</code>", req, availList)
		},
		ErrGeneric: func(errorID string) string {
			return fmt.Sprintf("متأسفانه ارتباط با سرور مبدأ برقرار نشد. لطفاً لینک را بررسی کرده و چند لحظه دیگر دوباره بفرستید.\n<code>کد پیگیری: %s</code>", errorID)
		},
	},
	LangEN: {
		Start: "👋 Hi! Welcome to Mimo.\nSend a link to a video, song or photo and I'll fetch it. Help: /help",
		Help: func(botUsername string) string {
			return fmt.Sprintf("📖 Help\n1. Copy the link.\n2. Send it here.\n3. Get your file.\n📜 History: /history │ 🌐 Language: /language\n🤖 @%s", botUsername)
		},
		ChooseLanguage: "<b>Choose your language / زبان خود را انتخاب کنید:</b>",
		LangChanged:    "Language updated successfully ✓",
		BtnFA:          "فارسی 🇮🇷",
		BtnEN:          "English 🇬🇧",
		CheckingLink:   "▸ Checking link... ⏳",
		CachedInstant:  "⚡ Sending instantly from cache...",
		QueueWaiting: func(pos int) string {
			return fmt.Sprintf("⏳ Waiting in queue (position <code>%d</code>)...", pos)
		},
		DownloadingProgress: func(bar string) string {
			return fmt.Sprintf("▸ Downloading... ⚡\n<code>%s</code>", bar)
		},
		UploadingProgress: func(bar string) string {
			return fmt.Sprintf("▸ Uploading... 📤\n<code>%s</code>", bar)
		},
		ServerBusyFlood: func(sec int) string {
			return fmt.Sprintf("⏳ Server busy, please wait (%ds)...", sec)
		},
		CarouselDetected: func(total int) string {
			return fmt.Sprintf("📸 Instagram album with <code>%d</code> items detected.\nProcessing one by one... ⏳", total)
		},
		CarouselItemTitle: func(current, total int) string {
			return fmt.Sprintf("Instagram (item %d of %d)", current, total)
		},
		SourceLabel:   "Source",
		DurationLabel: "Duration",
		SizeLabel:     "Size",
		ArtistLabel: func(artist string) string {
			return fmt.Sprintf("👤 Artist: %s", artist)
		},
		BtnDownload:        "Download",
		BtnCancel:          "✕ Cancel",
		BtnGetMP3:          "🎵 Get MP3",
		BtnCheckJoin:       "Check Membership ✓",
		BtnJoinChannel:     "🔗 Join Channel",
		ForceJoinPrompt:    "<b>📢 Channel Membership Required</b>\n\n<blockquote>To use the bot and download media, please join the channel below and click 'Check Membership ✓':</blockquote>",
		ForceJoinNotYet:    "⚠️ You have not joined the channel yet! Please join first.",
		ForceJoinConfirmed: "✓ Membership confirmed. Please send your link again.",
		HistoryTitle:       "<b>📜 Your Download History</b>\nSelect a platform to view your last 5 downloads:",
		HistoryEmpty: func(platform string) string {
			return fmt.Sprintf("<b>📜 History (%s)</b>\nNo downloads recorded yet.", platform)
		},
		HistoryRecent: func(platform string) string {
			return fmt.Sprintf("<b>📜 5 Recent Downloads (%s):</b>", platform)
		},
		BtnBack:             "🔙 Back",
		HistBtnInstagram:    "📸 Instagram",
		HistBtnYouTube:      "▶️ YouTube",
		HistBtnTikTok:       "🎶 TikTok",
		HistBtnAll:          "🌐 All Downloads",
		ErrInvalidURL:       "<b>✕ Error:</b> Invalid URL.\nPlease send a valid internet link.",
		ErrRateLimit: func(sec int) string {
			return fmt.Sprintf("⏳ Rate limited. Please try again in <code>%d</code> seconds.", sec)
		},
		ErrActiveJob:      "You already have an active download in progress. Please wait for it to complete.",
		ErrSessionExpired: "⏳ Session expired. Please send the link again.",
		ErrRecordNotFound: "✕ Download record not found.",
		ErrMaxSize: func(errorID string) string {
			return fmt.Sprintf("File size exceeds server safe limit. Please choose a lower quality or MP3.\n<code>Error ID: %s</code>", errorID)
		},
		ErrMaxDuration: func(errorID string) string {
			return fmt.Sprintf("Video duration exceeds allowed limit or is a livestream.\n<code>Error ID: %s</code>", errorID)
		},
		ErrSpotifyDRM: "<blockquote>⚠️ Direct Spotify tracks are DRM-protected. Please send the song name or its YouTube/SoundCloud link!</blockquote>",
		ErrInstagramPrivate: func(errorID string) string {
			return fmt.Sprintf("This Instagram post is private or requires login.\n<code>Error ID: %s</code>", errorID)
		},
		ErrSourceBlocked: func(errorID string) string {
			return fmt.Sprintf("Connection to source server temporarily limited. Please try again in a few minutes.\n<code>Error ID: %s</code>", errorID)
		},
		ErrTimeout: func(errorID string) string {
			return fmt.Sprintf("Download timed out. Please try again.\n<code>Error ID: %s</code>", errorID)
		},
		ErrPrivateMedia: func(errorID string) string {
			return fmt.Sprintf("This media is private or members-only.\n<code>Error ID: %s</code>", errorID)
		},
		ErrTikTok: func(errorID string) string {
			return fmt.Sprintf("Failed to connect to TikTok server. Please try again shortly.\n<code>Error ID: %s</code>", errorID)
		},
		ErrQualityNotAvailable: func(req string, avail []string) string {
			availList := strings.Join(avail, ", ")
			if availList != "" {
				availList += ", MP3"
			} else {
				availList = "MP3"
			}
			return fmt.Sprintf("⚠️ The requested quality (<b>%s</b>) is not available for this video.\n✅ Available qualities:\n<code>%s</code>", req, availList)
		},
		ErrGeneric: func(errorID string) string {
			return fmt.Sprintf("Failed to fetch from source. Please check the link and try again shortly.\n<code>Error ID: %s</code>", errorID)
		},
	},
}

func Get(lang Language) *Dictionary {
	if d, ok := Translations[lang]; ok {
		return d
	}
	return Translations[LangFA]
}
