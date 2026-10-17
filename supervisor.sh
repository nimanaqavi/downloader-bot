#!/usr/bin/env bash
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
export GOMEMLIMIT=100MiB
cd /home/hermemssss/mimo

LOG_FILE="/home/hermemssss/mimo/bot.log"

if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE") -gt 5242880 ]; then
    tail -n 100 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

while true; do
    echo "$(date): Starting mimo Go binary..." >> "$LOG_FILE"
    /home/hermemssss/mimo/mimo >> "$LOG_FILE" 2>&1
    sleep 3
done
