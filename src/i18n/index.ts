import { escapeHtml } from "../utils/formatting.js";

export type Language = "fa" | "en";

export function isolate(text: string): string {
  if (!text) return "";
  return `⁨${text}⁩`;
}

export const translations = {
  fa: {
    start: [
      "👋 سلام! به میمو خوش اومدی.",
      "لینک ویدیو، آهنگ یا عکس رو بفرست تا برات بگیرم. راهنما: /help"
    ].join("\n"),
    help: (botUsername: string) => [
      "📖 راهنما",
      "۱. لینک رو کپی کن.",
      "۲. توی چت بفرست.",
      "۳. فایل رو تحویل بگیر.",
      "📜 تاریخچه: /history │ 🌐 زبان: /language",
      `🤖 @${botUsername}`
    ].join("\n"),
    choose_language: "<b>زبان خود را انتخاب کنید / Choose your language:</b>",
    lang_changed: "زبان با موفقیت تغییر کرد ✓",
    btn_fa: "فارسی 🇮🇷",
    btn_en: "English 🇬🇧",
    checking_link: "▸ در حال بررسی لینک... ⏳",
    cached_instant: "⚡ در حال ارسال فوری از کش...",
    queue_waiting: (pos: number) => `⏳ در نوبت دانلود (نفر <code>${pos}</code>)...`,
    downloading_progress: (bar: string) => `▸ در حال دانلود... ⚡\n<code>${bar}</code>`,
    uploading_progress: (bar: string) => `▸ در حال آپلود... 📤\n<code>${bar}</code>`,
    server_busy_flood: (sec: number) => `⏳ سرور شلوغه، چند لحظه صبر کن (${sec}s)...`,
    carousel_detected: (total: number) =>
      `📸 آلبوم اینستاگرام شامل <code>${total}</code> آیتم شناسایی شد.\nدر حال دریافت و ارسال تک‌تک... ⏳`,
    carousel_item_title: (current: number, total: number) =>
      `اینستاگرام (آیتم ${current} از ${total})`,
    source_label: "منبع",
    duration_label: "مدت",
    size_label: "حجم",
    artist_label: (artist: string) => `👤 خواننده: ${artist}`,
    btn_download: "دانلود",
    btn_cancel: "✕ لغو",
    btn_get_mp3: "🎵 دریافت MP3",
    btn_check_join: "بررسی عضویت ✓",
    btn_join_channel: "🔗 عضویت در کانال",
    force_join_prompt: [
      "<b>📢 عضویت در کانال الزامی است</b>",
      "<blockquote>جهت استفاده از ربات و دریافت فایل، لطفاً ابتدا در کانال زیر عضو شوید، سپس روی دکمه «بررسی عضویت ✓» بزنید:</blockquote>"
    ].join("\n\n"),
    force_join_not_yet: "⚠️ هنوز در کانال عضو نشده‌اید! لطفاً ابتدا عضو شوید.",
    force_join_confirmed: "✓ عضویت شما تأیید شد. لطفاً لینک را دوباره ارسال کنید.",
    history_title: "<b>📜 تاریخچه دانلودهای شما</b>\nپلتفرم مورد نظر را برای مشاهده ۵ دانلود اخیر انتخاب کنید:",
    history_empty: (platform: string) => `<b>📜 تاریخچه (${platform})</b>\nهنوز دانلودی در این بخش ثبت نشده است.`,
    history_recent: (platform: string) => `<b>📜 ۵ دانلود اخیر (${platform}):</b>`,
    btn_back: "🔙 بازگشت",
    hist_btn_instagram: "📸 اینستاگرام",
    hist_btn_youtube: "▶️ یوتیوب",
    hist_btn_tiktok: "🎶 تیک‌تاک",
    hist_btn_all: "🌐 همه دانلودها",
    err_invalid_url: "<b>✕ خطا:</b> لینک ارسالی نامعتبر است.\nلطفاً یک لینک معتبر اینترنتی ارسال کنید.",
    err_rate_limit: (sec: number) => `⏳ لطفاً پس از <code>${sec}</code> ثانیه دوباره تلاش کنید.`,
    err_active_job: "شما هم‌اکنون یک دانلود در حال پردازش در صف دارید. لطفاً تا پایان آن صبر کنید.",
    err_session_expired: "⏳ نشست منقضی شده است. لطفاً لینک را دوباره ارسال کنید.",
    err_record_not_found: "✕ رکورد دانلود یافت نشد.",
    err_max_size: (errorId: string) =>
      `حجم این فایل بیشتر از سقف مجاز سرور است. لطفاً کیفیت پایین‌تر یا نسخه صوتی را انتخاب کنید.\n<code>کد پیگیری: ${errorId}</code>`,
    err_max_duration: (errorId: string) =>
      `مدت زمان این ویدیو بیشتر از حد مجاز است یا در حال پخش زنده (Live) می‌باشد.\n<code>کد پیگیری: ${errorId}</code>`,
    err_spotify_drm:
      "<blockquote>⚠️ آهنگ‌های مستقیم اسپاتیفای قفل هستند و نمیشه مستقیم دانلودشون کرد. لطفاً اسم آهنگ یا لینکش از یوتیوب/ساندکلاد رو بفرست تا فوری تحویل بدم!</blockquote>",
    err_instagram_private: (errorId: string) =>
      `این پست اینستاگرام خصوصی (Private) است یا نیاز به ورود به حساب دارد.\n<code>کد پیگیری: ${errorId}</code>`,
    err_source_blocked: (errorId: string) =>
      `ارتباط با سرور مبدأ موقتاً محدود شده است. لطفاً چند دقیقه دیگر امتحان کنید.\n<code>کد پیگیری: ${errorId}</code>`,
    err_timeout: (errorId: string) =>
      `زمان دانلود طولانی شد و متوقف گردید. لطفاً مجدداً امتحان کنید.\n<code>کد پیگیری: ${errorId}</code>`,
    err_private_media: (errorId: string) =>
      `این ویدیو خصوصی یا مخصوص اعضا است و امکان دانلود آن وجود ندارد.\n<code>کد پیگیری: ${errorId}</code>`,
    err_tiktok: (errorId: string) =>
      `ارتباط با سرور تیک‌تاک برقرار نشد. لطفاً چند لحظه بعد مجدداً امتحان کنید.\n<code>کد پیگیری: ${errorId}</code>`,
    err_generic: (errorId: string) =>
      `متأسفانه ارتباط با سرور مبدأ برقرار نشد. لطفاً لینک را بررسی کرده و چند لحظه دیگر دوباره بفرستید.\n<code>کد پیگیری: ${errorId}</code>`
  },
  en: {
    start: [
      "👋 Hi! Welcome to Mimo.",
      "Send a link to a video, song or photo and I'll fetch it. Help: /help"
    ].join("\n"),
    help: (botUsername: string) => [
      "📖 Help",
      "1. Copy the link.",
      "2. Send it here.",
      "3. Get your file.",
      "📜 History: /history │ 🌐 Language: /language",
      `🤖 @${botUsername}`
    ].join("\n"),
    choose_language: "<b>Choose your language / زبان خود را انتخاب کنید:</b>",
    lang_changed: "Language updated successfully ✓",
    btn_fa: "فارسی 🇮🇷",
    btn_en: "English 🇬🇧",
    checking_link: "▸ Checking link... ⏳",
    cached_instant: "⚡ Sending instantly from cache...",
    queue_waiting: (pos: number) => `⏳ Waiting in queue (position <code>${pos}</code>)...`,
    downloading_progress: (bar: string) => `▸ Downloading... ⚡\n<code>${bar}</code>`,
    uploading_progress: (bar: string) => `▸ Uploading... 📤\n<code>${bar}</code>`,
    server_busy_flood: (sec: number) => `⏳ Server busy, please wait (${sec}s)...`,
    carousel_detected: (total: number) =>
      `📸 Instagram album with <code>${total}</code> items detected.\nProcessing one by one... ⏳`,
    carousel_item_title: (current: number, total: number) =>
      `Instagram (item ${current} of ${total})`,
    source_label: "Source",
    duration_label: "Duration",
    size_label: "Size",
    artist_label: (artist: string) => `👤 Artist: ${artist}`,
    btn_download: "Download",
    btn_cancel: "✕ Cancel",
    btn_get_mp3: "🎵 Get MP3",
    btn_check_join: "Check Membership ✓",
    btn_join_channel: "🔗 Join Channel",
    force_join_prompt: [
      "<b>📢 Channel Membership Required</b>",
      "<blockquote>To use the bot and download media, please join the channel below and click 'Check Membership ✓':</blockquote>"
    ].join("\n\n"),
    force_join_not_yet: "⚠️ You have not joined the channel yet! Please join first.",
    force_join_confirmed: "✓ Membership confirmed. Please send your link again.",
    history_title: "<b>📜 Your Download History</b>\nSelect a platform to view your last 5 downloads:",
    history_empty: (platform: string) => `<b>📜 History (${platform})</b>\nNo downloads recorded yet.`,
    history_recent: (platform: string) => `<b>📜 5 Recent Downloads (${platform}):</b>`,
    btn_back: "🔙 Back",
    hist_btn_instagram: "📸 Instagram",
    hist_btn_youtube: "▶️ YouTube",
    hist_btn_tiktok: "🎶 TikTok",
    hist_btn_all: "🌐 All Downloads",
    err_invalid_url: "<b>✕ Error:</b> Invalid URL.\nPlease send a valid internet link.",
    err_rate_limit: (sec: number) => `⏳ Rate limited. Please try again in <code>${sec}</code> seconds.`,
    err_active_job: "You already have an active download in progress. Please wait for it to complete.",
    err_session_expired: "⏳ Session expired. Please send the link again.",
    err_record_not_found: "✕ Download record not found.",
    err_max_size: (errorId: string) =>
      `File size exceeds server safe limit. Please choose a lower quality or MP3.\n<code>Error ID: ${errorId}</code>`,
    err_max_duration: (errorId: string) =>
      `Video duration exceeds allowed limit or is a livestream.\n<code>Error ID: ${errorId}</code>`,
    err_spotify_drm:
      "<blockquote>⚠️ Direct Spotify tracks are DRM-protected. Please send the song name or its YouTube/SoundCloud link!</blockquote>",
    err_instagram_private: (errorId: string) =>
      `This Instagram post is private or requires login.\n<code>Error ID: ${errorId}</code>`,
    err_source_blocked: (errorId: string) =>
      `Connection to source server temporarily limited. Please try again in a few minutes.\n<code>Error ID: ${errorId}</code>`,
    err_timeout: (errorId: string) =>
      `Download timed out. Please try again.\n<code>Error ID: ${errorId}</code>`,
    err_private_media: (errorId: string) =>
      `This media is private or members-only.\n<code>Error ID: ${errorId}</code>`,
    err_tiktok: (errorId: string) =>
      `Failed to connect to TikTok server. Please try again shortly.\n<code>Error ID: ${errorId}</code>`,
    err_generic: (errorId: string) =>
      `Failed to fetch from source. Please check the link and try again shortly.\n<code>Error ID: ${errorId}</code>`
  }
};

export type TranslationKey = keyof typeof translations.fa;

export function t<K extends TranslationKey>(
  lang: Language,
  key: K,
  ...args: (typeof translations.fa)[K] extends (...a: any[]) => any
    ? Parameters<(typeof translations.fa)[K]>
    : []
): string {
  const selectedLang = lang === "en" ? "en" : "fa";
  const entry = translations[selectedLang][key];

  if (typeof entry === "function") {
    // @ts-ignore
    return entry(...args);
  }

  return (entry as string) || (translations.fa[key] as string) || "";
}
