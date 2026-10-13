# Mimo Multi-Downloader Telegram Bot

A lightweight, high-performance TypeScript Telegram bot that downloads public media from virtually any platform supported by `yt-dlp` (YouTube, Instagram, TikTok, Twitter/X, Facebook, Reddit, SoundCloud, and generic web links). Built for low-resource environments (e.g. Alwaysdata 256 MB RAM VPS).

---

## ⚡️ Key Features

- **Universal Multi-Downloader**:
  - **YouTube**: Dedicated inline quality menu (`720p`, `480p`, `360p`, `MP3`) with aspect-ratio-safe format rules.
  - **Instagram**: Single posts, reels, and multi-slide carousels (up to 10 items processed one-by-one with immediate file unlinking).
  - **TikTok, Twitter/X, Facebook, Reddit, SoundCloud**: Stream-copy progressive MP4 downloads up to 720p without heavy CPU re-encoding.
  - **Any Web Link**: Automatic detection and extraction for any site supported by `yt-dlp`.
  - **Audio (MP3) on Demand**: Download audio from any site by prefixing links with `mp3` (e.g., `mp3 https://...`).
- **Security & Hardening**:
  - Full SSRF protection blocking private IPs, link-local addresses, loopback (`127.0.0.1`, `::1`), and malicious DNS rebinding.
  - Safe child process execution using argument arrays (zero shell injection risk).
  - Maximum media duration ceiling (default 3 hours, configurable).
- **Resource Protection for 256 MB VPS**:
  - Dynamic disk space calculations factoring in single-stream vs separate DASH stream merges.
  - SQLite WAL mode with memory cache capped at 2 MB (`cache_size = -2000`) and `mmap_size = 0`.
  - GramJS MTProto uploader tuned to 2 workers to prevent memory spikes during high-speed upload.
  - Automatic temp directory cleanup on startup and after every job (success or failure).
- **Nightly yt-dlp Updates**: Automatic 24-hour maintenance cycle updating `yt-dlp` without restarting the Node server.

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BOT_TOKEN` | *Required* | Telegram Bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_USER_IDS` | *Required* | Comma-separated list of numeric Telegram user IDs |
| `DATABASE_PATH` | `./data/bot.db` | SQLite database file location |
| `TELEGRAM_FILE_LIMIT_MB` | `500` | Maximum file size allowed (tested up to 500 MB via MTProto) |
| `MAX_DURATION_SECONDS` | `10800` | Maximum allowed media duration in seconds (3 hours) |
| `DISK_SAFETY_MARGIN_MB` | `100` | Safety disk margin reserved for database and OS |
| `RATE_LIMIT_MAX` | `3` | Max download requests allowed per window |
| `RATE_LIMIT_WINDOW_SECONDS`| `60` | Rate-limit window in seconds |
| `DOWNLOAD_TIMEOUT_SECONDS` | `300` | Maximum download runtime before timing out |
| `AUTO_UPDATE_YTDLP` | `false` | Enable nightly background updates for `yt-dlp` |
| `INSTAGRAM_COOKIES_PATH` | *Optional* | Path to Netscape cookies file for restricted media |
| `TELEGRAM_API_ID` | `2040` | Telegram MTProto Client API ID |
| `TELEGRAM_API_HASH` | `...` | Telegram MTProto Client API Hash |

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
