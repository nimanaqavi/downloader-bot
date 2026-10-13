# Instagram Telegram Downloader

A TypeScript Telegram bot that downloads public Instagram posts, reels, TV videos, and story links through `yt-dlp`. It stores users and download results in SQLite and provides an owner-only admin panel inside Telegram.

## Features

- Strict Instagram URL validation and per-user rate limiting
- Download status updates, thumbnail uploads, 50 MB default size guard, and temporary-file cleanup
- SQLite user/download tracking with automatic versioned migrations
- Admin user list, download history, per-user stats, ban/unban controls, and pagination
- Global statistics, success rate, and most-active-user leaderboard
- Text/photo/video broadcasts using Telegram's native message-copy API
- Startup checks for `yt-dlp` and `ffmpeg`, plus optional `yt-dlp` auto-update

## Requirements

- Node.js 20 or newer
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Python 3 with pip, used to install `yt-dlp`
- `yt-dlp` and `ffmpeg` available in `PATH`

The bot deliberately fails at startup with an actionable error if `yt-dlp` or `ffmpeg` is missing.

## Install System Dependencies

Linux/macOS:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The script installs `yt-dlp` through pip. It installs ffmpeg through `apt` on Debian/Ubuntu or Homebrew on macOS. Existing installations are detected and skipped.

Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup.ps1
```

The PowerShell script uses Python's pip for `yt-dlp` and `winget` for ffmpeg. Open a new terminal afterward so newly installed commands are visible in `PATH`.

## Configure

Install Node dependencies and create the environment file:

```bash
npm install
cp .env.example .env
```

On Windows, create `.env` from `.env.example` manually or run `Copy-Item .env.example .env`.

Required settings:

```dotenv
BOT_TOKEN=123456789:your_bot_token
ADMIN_USER_IDS=123456789,987654321
```

Find your numeric Telegram user ID through a utility bot such as `@userinfobot`. Admin commands silently ignore non-admin users.

Optional settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/bot.db` | SQLite file location |
| `RATE_LIMIT_MAX` | `3` | Downloads allowed per rate-limit window |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window |
| `TELEGRAM_FILE_LIMIT_MB` | `50` | Maximum file sent through Telegram Bot API |
| `DOWNLOAD_TIMEOUT_SECONDS` | `180` | Maximum `yt-dlp` runtime per request |
| `AUTO_UPDATE_YTDLP` | `false` | Run `yt-dlp -U` before accepting requests |
| `INSTAGRAM_COOKIES_PATH` | empty | Absolute or project-relative Netscape cookies file |

`AUTO_UPDATE_YTDLP=true` helps keep extraction compatible with Instagram changes, but it adds startup latency. An update failure is logged and does not prevent startup when the installed version remains usable.

Some stories, age-restricted media, and authenticated posts require Instagram cookies. Export a Netscape-format cookies file from a browser session and set `INSTAGRAM_COOKIES_PATH`. Protect this file like a password and never commit it. Private content is still subject to the permissions of that Instagram account.

## Run

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

The database directory and schema are created automatically on first launch. Stop the bot with `Ctrl+C` to close Telegram polling and SQLite cleanly.

## Bot Usage

- `/start` or `/help`: user instructions
- Send an Instagram `/p/`, `/reel/`, `/tv/`, or `/stories/` URL to download it
- `/admin`: owner-only inline admin panel
- `/cancel`: cancel an in-progress admin broadcast prompt

Broadcasts copy the selected Telegram message to every known user. Telegram recipients who blocked the bot or deleted their account are counted as failures. Large broadcasts are sequential to avoid aggressive API bursts and may take time.

## Notes

- Telegram's hosted Bot API commonly limits bot uploads to 50 MB. Keep `TELEGRAM_FILE_LIMIT_MB=50` unless using an API setup with a different verified limit.
- Download history records successes and failures. Failed downloads have a null file size because no valid final media was available.
- Instagram and Telegram terms and local copyright laws apply. Only download or redistribute media you are authorized to use.
