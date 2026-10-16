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

## ✅ Completed Tasks (v3c Production Milestone)

### پیش‌نیاز
- [x] ثبت تگ گیت `pre-v3c-backup` قبل از شروع هرگونه تغییر کد.

### فاز ۰: گزارش وضعیت محیط زنده (Production Status)
- [x] مشخص‌سازی دقیق میزبان پروداکشن فعلی (`ssh-telbot.alwaysdata.net` / `185.31.41.84`).
- [x] بررسی و گزارش پروسس منیجر فعال (PM2 روی سرور، عدم وجود نمونه موازی).
- [x] شمارش دقیق پروسه‌های Node ربات روی سرور (دقیقاً ۱ پروسه فعال).
- [x] گزارش مسیر فایل دیتابیس زنده (`/home/telbot/mimo/data/bot.db`).
- [x] بررسی و مقایسه نسخه مایگریشن/اسکیما در دیتابیس زنده و دیتابیس `Downloads\bot.db` (هر دو نسخه ۶).
- [x] تضمین رفتار فقط‌خواندنی (Read-Only) نسبت به فایل دیتابیس قدیمی در Downloads.

### فاز ۱: ادغام بدون‌اتلاف دیتابیس (Lossless Database Merge)
- [x] تهیه بکاپ کامل دیتابیس زنده با دستور بومی `.backup` SQLite (یک نسخه روی سرور و یک نسخه روی سیستم لوکال).
- [x] اجرای شبیه‌سازی کامل (Dry-run) روی دو کپی مجزا و گزارش آماری تفکیکی:
  - تعداد کاربران: ۳ کاربر زنده، ۱۴ کاربر قدیمی، ۲ مشترک، ۱ کاربر جدید زنده، مجموع ۱۵ کاربر.
  - تعداد دانلودها: ۲۵ دانلود زنده، ۱۹۲ دانلود قدیمی، ۸ تکراری، ۱۸۴ جدید، مجموع ۲۰۹ دانلود.
  - کاربران مسدود: ۰ نفر، تعارض: ۰ مورد.
- [x] اجرای ادغام روی دیتابیس سرور با `ATTACH DATABASE` در قالب یک تراکنش واحد با `busy_timeout` ایمن بدون ری‌استارت بات.
- [x] اعمال قوانین تلفیق داده با حفظ کلید `telegram_id` و حفظ کامل کاربران جدید.
- [x] بازنگاشت `downloads` با `telegram_id` و حذف تکراری‌های همسان.
- [x] اعتبارسنجی پس از ادغام: دقیقاً ۱۵ کاربر و ۲۰۹ دانلود در دیتابیس زنده ثبت شد.

### فاز ۲: اصلاح دانلود عکس‌ها و کاروسل‌های اینستاگرام
- [x] بازتولید خطای دانلود عکس روی سرور و استخراج ریشه تحمیل `--remux-video mp4` و فیلترهای ویدیویی به عکس‌ها.
- [x] تفکیک دقیق نوع هر آیتم با `detectItemMediaType` از روی متادیتا (`ext`, `vcodec`, `acodec`).
- [x] پروب اولیه آیتم‌ها با `probeItem` و بازرسی هدر بایت‌های جادویی (Magic Bytes) برای تصاویر فاقد پسوند معتبر.
- [x] پشتیبانی کامل از کاروسل‌های مخلوط (عکس + ویدیو) تا سقف ۱۰ آیتم، ارسال ترتیبی و حذف فوری فایل موقت هر اسلاید.
- [x] ارسال تصاویر از طریق `sendPhoto` در تلگرام (و سوئیچ به `sendDocument` در صورت ابعاد نامعتبر یا حجم بالای ۱۰ مگابایت).
- [x] آزمون‌های واقعی روی سرور: ریلز (۱.۶۳ مگابایت)، عکس خالص بدون تبدیل به ویدیو (۱۶.۴ کیلوبایت)، پست خصوصی.

### فاز ۳: بهینه‌سازی سرعت (فقط بر پایه اندازه‌گیری مستند)
- [x] اثبات سرعت مرج استریم‌های یوتیوب: کمتر از ۱.۵ ثانیه برای فایل ۸۱ مگابایتی.
- [x] ارزیابی اثر `--concurrent-fragments` با مقادیر ۱، ۴ و ۸ روی سرور.
- [x] تک‌فراخوانی متادیتا با کش حافظه (`probeCache`) و ثبت بهبود ۶۰.۶٪ (صرفه‌جویی ۸.۲ ثانیه برای هر درخواست).
- [x] مانیتورینگ رم: ثبت مصرف بین ۵۳ تا ۵۶ مگابایت (زیر سقف ۲۲۰ مگابایت).

### فاز ۴: سیستم استیکرهای پلتفرم
- [x] ایجاد ابزار اختصاصی ادمین در چت خصوصی بات برای تحلیل و انتساب استیکر به شش پلتفرم اصلی (`src/bot/handlers/sticker.ts`).
- [x] ارسال استیکر پلتفرم بلافاصله قبل از مدیا (در کاروسل یک‌بار، بدون ارسال در خطا، با مهار کامل خطاها).
- [x] سوئیچ فعال/غیرفعال در پنل ادمین (`adm:toggle_stickers`).
- [x] گزارش فنی امکانات `custom_emoji` و نیازمندی‌های پرمیوم و فرگمنت در تلگرام.
- [x] نگارش تست‌های واحد: ۷۵ تست واحد سبز در ۲۲ سوئیت آزمون.

### فاز ۵: ممیزی امنیتی و مدیریت گیت‌هاب
- [x] اعتبارسنجی وضعیت Private بودن ریپازیتوری `nimanaqavi/downloader-bot`.
- [x] ممیزی خط‌به‌خط `.gitignore` برای استثنا کردن تمامی فایل‌های محرمانه، بکاپ‌ها، لاگ‌ها و دیتابیس‌ها.
- [x] پاک‌سازی عمیق کل تاریخچه گیت (Fast-export / Fast-import بایت‌به‌بایت) و حذف توکن‌ها و هش‌های قدیمی.
- [x] اسکن کامل تاریخچه گیت و اثبات صفر بودن تمامی سکرت‌های واقعی.
- [x] پوش به مخزن خصوصی گیت‌هاب و تگ `pre-v3c-backup` با موفقیت انجام شد.

### فاز ۶: رفع باگ‌های نهایی عملیاتی و بهینه‌سازی زنده
- [x] **تیک‌تاک:** حل قطعی چالش ضدبات تیک‌تاک با نصب `curl_cffi` و افزودن `--impersonate chrome` به خط لوله.
- [x] **یوتیوب ۷۲۰ و آپلود ۲ گیگابایت:**
  - حذف `--http-chunk-size 10M` جهت رفع خطای ۴۰۳ یوتیوب.
  - تنظیم شناسه و هش رسمی کلاینت iOS تلگرام (`API_ID = 17349`) برای رفع خطای ۴۱۳ و فعال‌سازی آپلود فایل تا ۲ گیگابایت.
  - دکمه‌های کیفیت کاملاً Stateless شدند و دیگر هرگز منقضی نمی‌شوند.
- [x] **عکس‌ها و کاروسل‌های اینستاگرام:** پیاده‌سازی استخراج‌کننده مستقیم پایتون (`scripts/instagramExtractor.py`) جهت دریافت باکیفیت‌ترین نسخه عکس‌ها (`thumbs[-1]`) از CDN بدون نیاز به فرمت ویدیویی و رفع خطای کاذب پست خصوصی.
