#!/usr/bin/env bash
LOCK_FILE="/tmp/mimo_supervisor.lock"
SUPERVISOR="/home/hermemssss/mimo/supervisor.sh"

flock -n "$LOCK_FILE" -c "$SUPERVISOR" &
