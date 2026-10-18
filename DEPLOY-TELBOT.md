# Deploy notes — mimo (Go)

## Live production
- **Account:** `telbot` (`telbot@ssh-telbot.alwaysdata.net`)
- **Project dir:** `/home/telbot/mimo/`
- **Binary:** `/home/telbot/mimo/mimo`
- **Database:** `/home/telbot/mimo/data/bot.db`
- **Cookies:** `/home/telbot/mimo/cookies.txt` (Instagram + Google/YouTube)
- **Mode:** long polling (no WEBHOOK_DOMAIN set)

## Build & deploy
```
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o mimo ./cmd/mimo
scp mimo telbot@ssh-telbot.alwaysdata.net:/home/telbot/mimo/
```

## Restart
```
pkill -x mimo
cd /home/telbot/mimo && setsid nohup ./mimo >> bot.log 2>&1 < /dev/null &
```
