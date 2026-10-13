#!/usr/bin/env bash
set -euo pipefail

has_command() {
  command -v "$1" >/dev/null 2>&1
}

if has_command yt-dlp; then
  echo "yt-dlp is already installed: $(yt-dlp --version)"
else
  if has_command python3; then
    PYTHON=python3
  elif has_command python; then
    PYTHON=python
  else
    echo "Error: Python is required. Install Python 3, then run this script again." >&2
    exit 1
  fi

  if ! "$PYTHON" -m pip --version >/dev/null 2>&1; then
    echo "Error: pip is not available for $PYTHON. Install pip, then run this script again." >&2
    exit 1
  fi
  echo "Installing yt-dlp with pip..."
  "$PYTHON" -m pip install --user -U yt-dlp
fi

if has_command ffmpeg; then
  echo "ffmpeg is already installed: $(ffmpeg -version 2>&1 | head -n 1)"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  if ! has_command brew; then
    echo "Error: Homebrew is required to install ffmpeg on macOS: https://brew.sh" >&2
    exit 1
  fi
  brew install ffmpeg
elif has_command apt-get; then
  echo "Installing ffmpeg with apt (sudo may prompt for a password)..."
  sudo apt-get update
  sudo apt-get install -y ffmpeg
else
  echo "Error: No supported package manager found. Install ffmpeg from https://ffmpeg.org/download.html" >&2
  exit 1
fi

echo "Dependency setup complete. If yt-dlp is not found in a new shell, add the Python user bin directory to PATH."
