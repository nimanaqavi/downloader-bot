# Mimo Multi-Downloader Task Status

## ✅ Completed Tasks

### Phase 1: Immediate Bugs & Security (V2)
- [x] **1.1: Telegram Menu Commands & Scoped Admin Menu**: Implemented `src/bot/commands.ts` with `setMyCommands` (`start`, `history`, `language`) and `setChatMenuButton`. Scoped `admin` command registered exclusively for IDs in `ADMIN_USER_IDS` via `BotCommandScopeChat`.
- [x] **1.2: Caption & Audio Metadata**: Added `buildFinalCaption` in `src/utils/formatting.ts` supporting `🎵` for audio, artist extraction from oEmbed/yt-dlp, native performer/title attributes in Telegram player, and HTML escaping under 1024 characters.
- [x] **1.3: GramJS Monitoring & FLOOD_WAIT Handling**: Implemented `src/services/gramjsMonitor.ts` tracking 24h flood waits, max wait duration, and last error. Added auto-delay retry and friendly user notice during flood waits.
- [x] **1.4: TikTok & TikWM Hardening**: Added 10s strict timeout, JSON validation, HTTPS-only enforcement, SSRF check on video play URL, redirect verification, `TIKTOK_PROVIDER` config switch (`tikwm_first`, `ytdlp_first`, `ytdlp_only`), usage counter, and circuit breaker (3 consecutive failures = 5-minute cooldown).
- [x] **1.5: Process Concurrency Audit**: Verified Alwaysdata native Site upstream process manager vs `supervisor.sh`/`keepalive.sh`.
- [x] **1.6: Error Tracking & Centralized Log Sanitization**: Implemented `generateErrorId` (`ERR-XXXXXX`) and `sanitizeLog` masking bot tokens and local file paths. Added per-user download queue limit (max 1 active task per user) in `src/services/downloadQueue.ts`.

### Phase 2: Enhanced Admin Panel & Force Join
- [x] **2.1: Extended System Stats**: Added RAM RSS bar, disk budget bar vs `MAX_DISK_BUDGET_MB`, queue depth, new users today, cache usage, yt-dlp version, TikWM usage, GramJS stats, and network speed percentiles (median & p95).
- [x] **2.2: Admin Error Alert Manager**: Implemented `src/admin/errorAlerts.ts` grouping platform errors by category and throttling duplicate alerts to at most once per 10 minutes.
- [x] **2.3: Sanitized Log Viewer**: Added `adm:logs` button in admin panel showing last 20 lines of log with sensitive tokens masked.
- [x] **2.4: Banned Users Management**: Added `adm:banned` view, and `/ban <id>` / `/unban <id>` admin commands.
- [x] **2.5: Chunked 100-User Broadcast**: Rewrote `src/admin/broadcast.ts` reading users in batches of 100, marking blocked users (403), respecting FloodWait (429), and adding inline cancel button. Verified memory diff < 15MB with 1,000 mock users.
- [x] **2.6: Channel Force Join (Optional)**: Implemented `src/services/forceJoin.ts` with toggle in admin panel, `/setchannel`, short `reqId` tracking with 10-minute TTL, admin exemption, and failure fallback preventing user lockouts.
- [x] **2.7: Migrations 3, 4, 5**: Database schema version 5 active with `download_cache`, `is_blocked`, and `bot_settings`.

### Phase 3: Performance & Speed Optimization
- [x] **3.1: Metrics Collection**: Implemented `src/services/metrics.ts` tracking metadata duration, download time, upload time, speed in MB/s, median, and p95.
- [x] **3.2: Download Speed Acceleration**: Configured `--concurrent-fragments 4` for DASH/HLS streams, `--http-chunk-size 10M` for YouTube, and in-memory metadata caching.
- [x] **3.3: Upload Streaming Optimization**: Configured GramJS 2-worker chunk streaming (512 KB chunks) without buffering whole media in RAM.
- [x] **3.4: Dynamic Disk Safe Sizing**: Preserved safe disk budgeting (500 MB single stream, 365 MB merged DASH stream).

### Phase 4: Unit Testing & Documentation
- [x] **4.1: Test Suite**: 49 unit tests across 16 suites passing with 0 failures (`tests/*.test.ts`).
- [x] **4.2: Documentation**: Updated `PROJECT_OVERVIEW.md`, `README.md`, and `TODO.md` with zero secret exposure.

---

## 📋 برنامه اقدام v3c (در انتظار اجرا)

### پیش‌نیاز
- [ ] ثبت تگ گیت `pre-v3c-backup` قبل از شروع هرگونه تغییر کد.

### فاز ۰: گزارش وضعیت محیط زنده (Production Status)
- [ ] مشخص‌سازی دقیق میزبان پروداکشن فعلی (`ssh-telbot.alwaysdata.net`).
- [ ] بررسی و گزارش پروسس منیجر فعال (PM2 روی سرور، عدم وجود نمونه موازی).
- [ ] شمارش دقیق پروسه‌های Node ربات روی سرور (دقیقاً ۱ پروسه فعال).
- [ ] گزارش مسیر فایل دیتابیس زنده (`/home/telbot/mimo/data/bot.db`).
- [ ] بررسی و مقایسه نسخه مایگریشن/اسکیما در دیتابیس زنده و دیتابیس `Downloads\bot.db`.
- [ ] تضمین رفتار فقط‌خواندنی (Read-Only) نسبت به فایل دیتابیس قدیمی در Downloads.

### فاز ۱: ادغام بدون‌اتلاف دیتابیس (Lossless Database Merge)
- [ ] تهیه بکاپ کامل دیتابیس زنده با دستور بومی `.backup` SQLite (یک نسخه روی سرور و یک نسخه روی سیستم لوکال).
- [ ] اجرای شبیه‌سازی کامل (Dry-run) روی دو کپی مجزا و گزارش آماری تفکیکی:
  - تعداد کاربران در دیتابیس زنده و قدیمی
  - تعداد اشتراک، اجتماع، تعداد رکورد دانلودها
  - لیست کاربران مسدود (is_banned) و موارد تعارض
- [ ] اجرای ادغام روی دیتابیس سرور با `ATTACH DATABASE` در قالب یک تراکنش واحد با `busy_timeout` ایمن بدون ری‌استارت بات (روشن ماندن سرویس برای جلوگیری از هدررفت درخواست‌های جدید).
- [ ] اعمال قوانین تلفیق داده:
  - کلید اصلی: `telegram_id`
  - کاربران فقط در دیتابیس قدیمی ➔ درج کامل با شناسه جدید
  - کاربران مشترک در هر دو ➔ `first_seen` کمترین، `last_active` بیشترین، `is_banned = 1` در صورت مسدودیت در هر کدام
  - `language` و `lang_set` و `is_blocked` از دیتابیس زنده (در صورت خالی بودن در زنده، از قدیمی با `lang_set = 1`)
  - کاربران فقط در دیتابیس زنده ➔ کاملاً دست‌نخورده
  - جدول `downloads` ➔ بازنگاشت کلید خارجی `user_id` با `telegram_id` جدید و حذف تکراری‌های همسان (کاربر، لینک، زمان)
  - نادیده گرفتن `download_cache` و `bot_settings`
  - نگاشت صریح ستون‌های ناموجود در نسخه قدیمی (مانند `lang_set`)
- [ ] اعتبارسنجی پس از ادغام (مقایسه تعداد نهایی با فرمول اجتماع و مجموع دانلودها)، نمایش در منوی `/admin` و امکان Rollback با بکاپ در صورت عدم تطابق.

### فاز ۲: اصلاح دانلود عکس‌ها و کاروسل‌های اینستاگرام
- [ ] بازتولید خطای دانلود عکس روی سرور با یک لینک عکس واقعی اینستاگرام و استخراج `stderr` ابزار `yt-dlp` جهت تأیید دقیق علت.
- [ ] تفکیک دقیق نوع هر آیتم از طریق فیلدهای JSON متادیتا (`ext`, `vcodec`, `acodec`):
  - در صورت تصویر بودن (عکس): عدم اعمال `--remux-video mp4` و قانون فرمت ویدیویی.
  - در صورت ویدیو بودن: اجرای پایپ‌لاین ویدیویی استاندارد.
- [ ] پشتیبانی کامل از کاروسل‌های مخلوط (عکس + ویدیو) تا سقف ۱۰ آیتم، ارسال ترتیبی و حذف فوری فایل هر آیتم از دیسک پس از ارسال.
- [ ] ارسال تصاویر از طریق `sendPhoto` در تلگرام (و سوئیچ به `sendDocument` در صورت ابعاد نامعتبر یا حجم بالای ۱۰ مگابایت).
- [ ] آزمون‌های واقعی روی سرور: تک‌عکس، چندعکس (کاروسل)، پست اسلایدی مخلوط، ریلز و پست خصوصی (تأیید پیام خطای مناسب).
- [ ] نگارش تست واحد اختصاصی برای تشخیص نوع آیتم‌ها در `tests/`.

### فاز ۳: بهینه‌سازی سرعت (فقط بر پایه اندازه‌گیری مستند)
- [ ] اجتناب صریح از افت کیفیت ویدیو (عدم تغییر فرمت یوتیوب)، عدم تغییر نوع ارسال صوت و عدم دستکاری پارت‌های ۵۱۲ کیلوبایتی GramJS.
- [ ] بنچ‌مارک و اندازه‌گیری روی سرور با فایل‌های واقعی حدود ۱۰۰ مگابایت و ۴۰۰ مگابایت:
  - جدول تفکیکی زمان: استخراج متادیتا، دانلود، پردازش/مرج ffmpeg، آپلود MTProto و سرعت خالص (MB/s).
  - ثبت دقیق زمان پردازش مرج استریم‌های صوتی/تصویری یوتیوب در هاست.
- [ ] تست مقایسه‌ای پرچم `--concurrent-fragments` با مقادیر ۱، ۴ و ۸ روی دانلود قطعات HLS/DASH.
- [ ] تست استخراج متادیتا در یک فراخوانی (Single-call) برای اینستاگرام و تیک‌تاک و سنجش تفاوت زمانی.
- [ ] اعمال انحصاری بهینه‌سازی‌هایی که سود زمانی واقعی داشته و مصرف رم را زیر ۲۲۰ مگابایت حفظ می‌کنند (با گزارش عددی دقیق).

### فاز ۴: سیستم استیکرهای پلتفرم
- [ ] ایجاد ابزار موقت اختصاصی ادمین در چت خصوصی بات:
  - تحلیل استیکر ارسالی ادمین: نوع (معمولی / custom_emoji)، انیمیشنی یا ویدیویی، نام پک، emoji، `file_id`، `file_unique_id` و `custom_emoji_id`.
  - دکمه‌های شیشه‌ای ذخیره برای پلتفرم‌ها (`YouTube`, `Instagram`, `TikTok`, `Spotify`, `SoundCloud`, `X`).
  - ذخیره در جدول `bot_settings` با کلید `platform_sticker:<platform>`.
  - ایزوله‌سازی کامل به طوری که برای کاربران عادی هیچ تغییری حس نشود.
- [ ] در صورت معمولی بودن استیکرها:
  - ارسال استیکر پلتفرم بلافاصله قبل از مدیا (در صورت موفقیت‌آمیز بودن دانلود و مسیر کش‌هیت).
  - در کاروسل فقط یک‌بار ارسال شود.
  - تعبیه سوئیچ فعال/غیرفعال در پنل ادمین (`PLATFORM_STICKERS`، پیش‌فرض روشن).
  - مهار خطا (Silent catch) در صورت نرسیدن استیکر تا مانع تحویل مدیا نشود.
- [ ] در صورت custom_emoji بودن استیکرها:
  - ارزیابی دقیق محدودیت‌ها و مستندات رسمی Telegram Bot API (نیازمندی‌های یوزرنیم فرگمنت یا پرمیوم ربات) و ارائه گزارش تحلیلی بدون اعمال کد.
- [ ] نگارش تست‌های واحد: کنترل دسترسی ادمین، ترتیب ارسال، مدیریت خطا و سوئیچ تنظیمات.

### فاز ۵: ممیزی امنیتی و مدیریت گیت‌هاب
- [ ] اعتبارسنجی وضعیت Private بودن ریپازیتوری `nimanaqavi/downloader-bot`.
- [ ] ممیزی خط‌به‌خط فایل `.gitignore` برای تضمین استثنا شدن کامل `.env*`, `data/`, `*.db`, `*.db-*`, کوکی‌ها، پوشه `backups/`, لاگ‌ها و `node_modules/`.
- [ ] اسکن عمیق کل تاریخچه گیت (تمامی کامیت‌ها، شاخه‌ها و تگ‌ها) برای شناسایی هرگونه سکرت تاریخی (توکن تلگرام، هش API، پسورد، کوکی و...).
- [ ] گزارش تعداد و نوع موارد احتمالی بدون چاپ مقادیر سکرت و ارائه راهکار پاک‌سازی کامل تاریخچه در صورت کشف مورد مشکوک.
- [ ] پوش نهایی روی گیت‌هاب صرفاً پس از اخذ تأییدیه صریح و کتبی شما.
