#!/usr/bin/env bash
LOCK_FILE="/tmp/mimo_telbot.lock"
SUPERVISOR="/home/telbot/mimo/supervisor.sh"

flock -n "$LOCK_FILE" -c "$SUPERVISOR" &
