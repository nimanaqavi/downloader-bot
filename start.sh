#!/usr/bin/env bash
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
export GOMEMLIMIT=100MiB
cd /home/telbot/mimo
exec /home/telbot/mimo/mimo
