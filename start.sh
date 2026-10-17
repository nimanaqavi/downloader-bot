#!/usr/bin/env bash
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
exec node --max-old-space-size=96 --expose-gc dist/src/index.js
