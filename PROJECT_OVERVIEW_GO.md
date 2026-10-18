# Mimo Telegram Downloader Bot - Go Architecture & Technical Specification

## 1. Executive Summary

- **System Purpose**: High-performance, low-memory universal Telegram downloader bot that accepts links from YouTube, Instagram, TikTok, Spotify, and generic web media, extracts high-quality video/audio/photo payloads, and delivers them directly to users in Telegram.
- **Runtime Environment**: Alwaysdata shared hosting (`ssh-telbot.alwaysdata.net`).
- **Resource Constraints**:
  - **RAM Limit**: 256 MB cgroup ceiling.
  - **Disk Quota**: 1 GB account limit (with 1.5 TB network storage for user home).
  - **Download Concurrency**: Strict concurrency limit of 1 (`concurrency: 1`) to preserve server CPU, network, and RAM stability.
- **Architectural Benchmark Achievement**:
  - Node.js baseline RSS: ~86 MB to 180 MB.
  - **Go Architecture RSS**: **~18 MB to 20 MB** (over 75% memory reduction).

---

## 2. Package Architecture (`internal/*` & `cmd/*`)

The codebase adheres to standard Go project layout:

```text
mimo/
├── cmd/
│   └── mimo/
│       └── main.go                 # Entrypoint, memory clamping, healthcheck HTTP server, graceful shutdown
├── internal/
│   ├── config/
│   │   └── config.go               # Environment loader, Zod-like validation, typed Config struct
│   ├── database/
│   │   ├── db.go                   # modernc.org/sqlite connection in WAL mode with tuned pragmas
│   │   ├── migrations.go           # Versioned schema migrations (v1 to v6)
│   │   ├── users.go                # User lifecycle, activity tracking, banning, language preferences
│   │   ├── downloads.go            # Download history records, filtering by platform
│   │   ├── cache.go                # Media hash caching for instant copyMessage deliveries
│   │   └── settings.go             # Dynamic runtime settings (Force Join, custom platform emojis)
│   ├── bot/
│   │   ├── bot.go                  # BotServer definition, telebot configuration, middleware pipeline
│   │   ├── callbacks.go            # Centralized CallbackQuery router, Form-Feed (\f) cleanup
│   │   ├── handlers_start.go       # /start, /help, /language handlers
│   │   ├── handlers_history.go     # /history platform-segmented download logs
│   │   └── handlers_download.go    # Download pipeline, quality card builder, progress throttler
│   ├── downloader/
│   │   ├── downloader.go           # yt-dlp wrapper, format selectors, metadata extractor
│   │   ├── queue.go                # FIFO channel-based worker queue (concurrency = 1)
│   │   ├── instagram.go            # Native Python carousel/photo CDN extractor
│   │   ├── tiktok.go               # TikWM API client with yt-dlp fallback
│   │   └── spotify.go              # Spotify oEmbed parser + YouTube/SoundCloud audio resolver
│   ├── mtproto/
│   │   └── uploader.go             # Lazy-initialized gotd/td MTProto client (>45MB uploads)
│   ├── admin/
│   │   ├── admin.go                # /admin dashboard, statistics, ban management, custom emojis
│   │   └── broadcast.go            # Throttled broadcast engine with flood-wait handling
│   ├── i18n/
│   │   └── i18n.go                 # Bilingual translation dictionaries (Persian & English)
│   └── utils/
│       ├── formatting.go           # Caption formatter, duration/bytes parser, hidden HTML thumbnail tags
│       ├── normalizer.go           # URL sanitization, tracking parameter stripping, shortlink expansion
│       ├── ssrf.go                 # SSRF protection: blocks loopback, link-local, private RFC 1918 subnets
│       ├── disk.go                 # Disk budget monitor with 10-minute cached du delta tracking
│       ├── errors.go               # User-friendly error translator with tracking error IDs
│       └── ratelimit.go            # In-memory sliding-window rate limiter (3 req/min per user)
├── scripts/
│   └── instagramExtractor.py       # High-resolution Instagram photo & carousel CDN resolver
├── start.sh                        # Runner script with GOMEMLIMIT=100MiB
├── supervisor.sh                   # Process watchdog that relaunches on termination
├── keepalive.sh                    # Lockfile-protected periodic cron/process watcher
└── DEPLOY-TELBOT.md                # Server operations and restart manual
```

---

## 3. Storage, Database & Memory Safeguards

### 3.1 Pure Go SQLite in WAL Mode
- **Driver**: `modernc.org/sqlite` (no CGO compiler or shared library dependency).
- **Connection Configuration**:
  ```sql
  PRAGMA journal_mode = WAL;
  PRAGMA cache_size = -2000;  -- 2MB memory cache
  PRAGMA mmap_size = 0;       -- Zero memory-mapped I/O to avoid virtual memory bloat
  PRAGMA busy_timeout = 5000; -- 5-second lock wait before SQLITE_BUSY
  ```
- **Concurrency**: `SetMaxOpenConns(1)` ensures atomic, single-writer SQLite integrity without file lock collisions.

### 3.2 Memory Clamping & Physical Disk TMPDIR
- **Go Memory Limit**: `debug.SetMemoryLimit(100 * 1024 * 1024)` sets a 100 MiB soft ceiling on Go runtime allocations, triggering aggressive garbage collection before approaching the 256 MB cgroup wall.
- **Explicit Garbage Collection**: `runtime.GC()` is invoked in `finally` and queue completion handlers.
- **Physical Disk Storage for TMPDIR**:
  - The Linux system `/tmp` is mounted on `tmpfs` (RAM). Writing large media files (100MB+ video + audio + ffmpeg merge output) to `/tmp` caused severe OOM SIGKILL terminations.
  - The application overrides `TMPDIR`, `TEMP`, and `TMP` to `/home/telbot/mimo/tmp` on physical network disk storage (1.5 TB available).
  - All `os.MkdirTemp` calls explicitly target `d.cfg.TempDir`.

---

## 4. Download Engine & Quality Pipeline

### 4.1 yt-dlp Low-Memory Execution Flags
- `--force-ipv4`: Ensures reliable connectivity on Alwaysdata IPv4 routes.
- `--no-js-runtimes`: Skips external Deno/Node JS execution to avoid 150MB+ runtime spikes.
- `--buffer-size 16K` & `--concurrent-fragments 1`: Restricts stream chunk buffers to 16KB.
- `--ffmpeg-location /home/telbot/bin`: Uses statically compiled `ffmpeg` and `ffprobe` binaries.
- `--postprocessor-args "ffmpeg:-threads 1 -movflags -faststart"`: Restricts ffmpeg to 1 thread and removes the heavy `faststart` second-pass moov-atom relocation during merger.

### 4.2 YouTube Player Client Strategy
- **Client Combination**: `youtube:player_client=android,visionos`
  - Bypasses SABR-only streaming limitations.
  - Resolves formats 720p (f398), 480p (f397), 360p (f18), and 128kbps Opus audio (f251) without requiring JS bot challenge solvers.
  - Cookies are explicitly **excluded** for YouTube to prevent bot challenge re-verification loops.

### 4.3 Native Instagram Photo & Carousel Extractor
- Instagram carousel posts containing photos fail in `yt-dlp` with `No video formats found!`.
- `scripts/instagramExtractor.py` directly parses Instagram metadata, extracts high-resolution image CDN links (`thumbs[-1]`), and downloads/sends items sequentially.

### 4.4 TikTok Dual-Engine Pipeline
- **Shortlink Resolution**: `ResolveShortLink` expands `vm.tiktok.com`, `vt.tiktok.com`, and `tiktok.com/t/...` via HTTP GET redirect tracking.
- **Primary Engine**: `TikWM` REST API for watermark-free MP4 extraction with circuit breaker protection (trips after 3 failures with 5-minute cooldown).
- **Fallback Engine**: `yt-dlp` using format `best[ext=mp4]/best`.

---

## 5. Telegram Interaction, Callbacks & Dual Upload

### 5.1 Telebot Callback Routing
- Telebot v3 internally prefixes callback data with Form-Feed (`\f`) and separates data with `|`.
- `CleanCallbackData` normalizes all incoming callbacks before routing:
  - Language selection: `set_lang:fa`, `set_lang:en`
  - History view: `hist:menu`, `hist:instagram`, `hist:youtube`, `hist:tiktok`, `hist:all`
  - Quality selection: `q:<ref>:<quality>` (stateless `y_<videoID>` for YouTube, SQLite-persisted for other platforms)
  - Audio extraction button: `mp3:<downloadID>`
  - Admin controls: `adm:*`
- Immediate `c.Respond()` call removes the client-side loading indicator instantly.

### 5.2 Quality Card & Thumbnail Embedding
- The quality card embeds a hidden HTML link: `<a href="THUMBNAIL_URL">&#8205;</a>`.
- `DisableWebPagePreview: false` is set on the quality card message, instructing Telegram to render the rich thumbnail preview above the inline quality buttons.
- Progress updates subsequent to button click explicitly set `DisableWebPagePreview: true` to prevent UI clutter.

### 5.3 Dual Upload Architecture
- **Files $\le 45\text{ MB}$ (Photos $\le 10\text{ MB}$)**:
  - Streamed directly from local disk via Telegram Bot API HTTP client (`tele.FromDisk(path)`).
- **Files $> 45\text{ MB}$ (up to 500 MB)**:
  - Handled by `gotd/td` MTProto client using official Telegram Desktop credentials (`API_ID=2040`, `API_HASH=b18441a1ff607e10a989891a5462e627`).
  - Lazy initialization: MTProto connects on-demand and triggers an idle disconnect timer after 60 seconds of inactivity to release network and memory resources.
