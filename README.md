# Mimo Multi-Downloader Telegram Bot

A lightweight, high-performance TypeScript Telegram bot that downloads public media from virtually any platform supported by `yt-dlp` (YouTube, Instagram, TikTok, Twitter/X, Facebook, Reddit, SoundCloud, Spotify, and generic web links). Built for low-resource environments (e.g. Alwaysdata 256 MB RAM VPS).

---

## ⚡️ Key Features

- **Universal Multi-Downloader**:
  - **YouTube**: Dedicated inline quality menu (`720p`, `480p`, `360p`, `MP3`) with aspect-ratio-safe format rules.
  - **Instagram**: Single posts, reels, and multi-slide carousels (up to 10 items processed one-by-one with immediate file unlinking).
  - **TikTok**: Fast watermark-free extraction using the TikWM API with automatic fallback to `yt-dlp`.
  - **Spotify**: Intelligent track title and artist resolution via public oEmbed with audio streaming.
  - **Twitter/X, Facebook, Reddit, SoundCloud**: Stream-copy progressive MP4 and MP3 downloads up to 720p without heavy CPU re-encoding.
  - **Audio (MP3) on Demand**: Download audio from any site by prefixing links with `mp3` (e.g., `mp3 https://...`) or clicking the `🎵 دریافت MP3` button under any finished video.
- **Security & Hardening**:
  - Full SSRF protection blocking private IPs, link-local addresses, loopback (`127.0.0.1`, `::1`), and malicious DNS rebinding.
  - Safe child process execution using argument arrays (zero shell injection risk).
  - Centralized log sanitization redacting Telegram bot tokens and server file paths.
  - Tracking error IDs (`ERR-XXXXXX`) shown to users and logged for painless troubleshooting.
  - Per-user queue throttling (max 1 active task per user) preventing queue exhaustion.
- **Resource Protection for 256 MB VPS**:
  - Dynamic disk space calculations factoring in single-stream vs separate DASH stream merges.
  - SQLite WAL mode with memory cache capped at 2 MB (`cache_size = -2000`) and `mmap_size = 0`.
  - GramJS MTProto uploader tuned to 2 workers to prevent memory spikes during high-speed upload.
  - Automatic temp directory cleanup on startup and after every job (success or failure).
- **Nightly yt-dlp Updates**: Automatic 24-hour maintenance cycle updating `yt-dlp` without restarting the Node server.
- **Admin Control Panel**:
  - In-depth system metrics: RAM RSS bar, disk budget bar, queue depth, new users, cache savings, GramJS FLOOD_WAIT stats, and download speed percentiles (median & p95).
  - Force join channel gating with instant verification and seamless download continuation.
  - Chunked broadcast sending (100 users/batch) with FloodWait handling and blocked user tracking.
  - Sanitized log viewer showing the last 20 lines without leaking tokens.

---

## ⚙️ Configuration (.env)

> **Important Notes on API Credentials:**
> - To use GramJS high-speed MTProto uploads, obtain your own `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from [my.telegram.org](https://my.telegram.org). Protect these credentials and never commit them to version control.
> - **TikTok Service Notice:** The bot uses the unofficial third-party TikWM service (`https://tikwm.com/api/`) for watermark-free downloads. User-submitted TikTok links are queried against this endpoint. You can control this behavior using `TIKTOK_PROVIDER`.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BOT_TOKEN` | *Required* | Telegram Bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_USER_IDS` | *Required* | Comma-separated list of numeric Telegram user IDs |
| `TELEGRAM_API_ID` | `2040` | Telegram MTProto Client API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | *Configured* | Telegram MTProto Client API Hash from my.telegram.org |
| `DATABASE_PATH` | `./data/bot.db` | SQLite database file location |
| `TELEGRAM_FILE_LIMIT_MB` | `500` | Maximum file size allowed (tested up to 500 MB via MTProto) |
| `MAX_DURATION_SECONDS` | `10800` | Maximum allowed media duration in seconds (3 hours) |
| `DISK_SAFETY_MARGIN_MB` | `100` | Safety disk margin reserved for database and OS |
| `MAX_DISK_BUDGET_MB` | `1000` | Real disk quota budget of your hosting account |
| `RATE_LIMIT_MAX` | `3` | Max download requests allowed per window |
| `RATE_LIMIT_WINDOW_SECONDS`| `60` | Rate-limit window in seconds |
| `DOWNLOAD_TIMEOUT_SECONDS` | `300` | Maximum download runtime before timing out |
| `AUTO_UPDATE_YTDLP` | `false` | Enable nightly background updates for `yt-dlp` |
| `INSTAGRAM_COOKIES_PATH` | *Optional* | Path to Netscape cookies file for restricted media |
| `TIKTOK_PROVIDER` | `tikwm_first` | Strategy: `tikwm_first`, `ytdlp_first`, or `ytdlp_only` |
| `STORAGE_CHANNEL_ID` | *Optional* | Private channel ID for permanent cache storage |
| `BOT_USERNAME` | `instagramdl_mahibot` | Bot username displayed in media captions |
| `WEBHOOK_DOMAIN` | *Optional* | Webhook domain for production environments |

---

## 🚀 Running the Bot

```bash
# Install dependencies
npm ci

# Compile TypeScript
npm run build

# Run unit tests
npm test

# Start in production
npm start
```
