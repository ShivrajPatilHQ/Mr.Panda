#!/usr/bin/env bash
# Mr. Panda installer — curl -fsSL https://raw.githubusercontent.com/ShivrajPatilHQ/Mr.Panda/main/install.sh | bash
set -euo pipefail

REPO="ShivrajPatilHQ/Mr.Panda"
APP_NAME="Mr Panda.app"

c() { printf '\033[%sm' "$1"; }
R="$(c 0)"; B="$(c 1)"; DIM="$(c 2)"; BLUE="$(c '38;5;69')"; RED="$(c '38;5;131')"; GOLD="$(c '38;5;179')"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Mr. Panda is currently macOS-only. Sorry!"
  exit 1
fi

printf '%s' "$BLUE"
cat << 'PANDA'

           .-""""""-.
        .-"  ..  ..  "-.
       /    (()  ()      \
      |     '.......'    |
       \    .---------.  /
        '--'  |||  |||'--'
           .--'|||||'--.
          /    '''''    \
         |  [Mr. Panda]  |
          \_____________/
PANDA
printf '%s\n' "$R"

echo "${B}Mr. Panda${R}${DIM} — your desktop research & writing sidekick${R}"
echo ""

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  ASSET="Mr.Panda-arm64.dmg"
  echo "${DIM}Detected Apple Silicon (arm64)${R}"
else
  ASSET="Mr.Panda.dmg"
  echo "${DIM}Detected Intel (x64)${R}"
fi

URL="https://github.com/$REPO/releases/latest/download/$ASSET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "${GOLD}==>${R} Downloading…"
if ! curl -fL --progress-bar "$URL" -o "$TMP/MrPanda.dmg"; then
  echo "${RED}Download failed.${R} Check your connection, or grab it manually:"
  echo "  https://github.com/$REPO/releases/latest"
  exit 1
fi

echo "${GOLD}==>${R} Mounting…"
MOUNT_DIR="$(hdiutil attach "$TMP/MrPanda.dmg" -nobrowse -readonly | tail -1 | awk -F '\t' '{print $NF}')"
if [ -z "$MOUNT_DIR" ] || [ ! -d "$MOUNT_DIR/$APP_NAME" ]; then
  echo "${RED}Couldn't read the disk image.${R}"
  exit 1
fi

if pgrep -f "$APP_NAME/Contents/MacOS/Mr Panda" > /dev/null 2>&1; then
  echo "${GOLD}==>${R} Closing the running panda…"
  pkill -f "$APP_NAME/Contents/MacOS/Mr Panda" 2>/dev/null || true
  sleep 1
fi

echo "${GOLD}==>${R} Installing to /Applications…"
rm -rf "/Applications/$APP_NAME"
if ! cp -R "$MOUNT_DIR/$APP_NAME" "/Applications/"; then
  echo "${RED}Couldn't write to /Applications.${R} Trying with sudo…"
  sudo cp -R "$MOUNT_DIR/$APP_NAME" "/Applications/"
fi

hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
xattr -cr "/Applications/$APP_NAME" 2>/dev/null || true

echo ""
echo "${B}🐼 Mr. Panda is installed.${R} Launching…"
open "/Applications/$APP_NAME"
