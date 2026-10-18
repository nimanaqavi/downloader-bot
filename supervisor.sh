#!/usr/bin/env bash
# Watchdog: relaunch the bot only if it is not already running.
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
export GOMEMLIMIT=100MiB
cd /home/telbot/mimo
LOG_FILE="/home/telbot/mimo/bot.log"

if [ -f "$LOG_FILE" ] && [ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 5242880 ]; then
    tail -n 100 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

if ! pgrep -x mimo > /dev/null 2>&1; then
    echo "$(date): bot not running, starting..." >> "$LOG_FILE"
    setsid nohup ./mimo >> "$LOG_FILE" 2>&1 < /dev/null &
fi
