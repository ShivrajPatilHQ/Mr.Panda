#!/usr/bin/env bash
# Mr. Panda installer — curl -fsSL https://raw.githubusercontent.com/ShivrajPatilHQ/Mr.Panda/main/install.sh | bash
set -euo pipefail

REPO="ShivrajPatilHQ/Mr.Panda"
APP_NAME="Mr Panda.app"

c() { printf '\033[%sm' "$1"; }
R="$(c 0)"; B="$(c 1)"; DIM="$(c 2)"; GOLD="$(c '38;5;179')"; RED="$(c '38;5;131')"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Mr. Panda is currently macOS-only. Sorry!"
  exit 1
fi

# ---- pixel panda banner: the exact app-icon sprite, rendered as truecolor
# half-blocks so the terminal shows the real Mr. Panda, not hand-drawn art. ----
SPRITE=(
  "..KKKK............KKKK.."
  ".KKKKKK..........KKKKKK."
  ".KKKKWWWWWWWWWWWWWWKKKK."
  "..KKWWWWWWWWWWWWWWWWKK.."
  "..WWWWWWWWWWWWWWWWWWWW.."
  "..WWSSSSSSSSSSSSSSSSWW.."
  "..WWSXSSSSSSSSSSSSXSWW.."
  "..WWWSSSSSSSSSSSSSSWWW.."
  "..WWWWWWWWWWWWWWWWWWWW.."
  "..WWWWWWWWWNNWWWWWWWWW.."
  "..WWWWWWWWWWWWWWWWWWWW.."
  "...WWWWWWWWWWWWWWWWWW..."
  "....TTTTTHHHHHHTTTTT...."
  "...TTTTTTTHRRHTTTTTTT..."
  "...TTTTTTTHRRHTTTTTTT..."
  "..TTTTTTTTTRRTTTTTTTTT.."
  "..TTTTTTTTTDRTTTTTTTTT.."
  "..KKKTTTTTTTTTTTTTTKKK.."
  "..KKKTTTTTTTTTTTTTTKKK.."
)
hexcol() {
  case "$1" in
    K) echo "23;23;28" ;;   N) echo "23;23;28" ;;
    W) echo "242;239;228" ;;
    S) echo "13;16;21" ;;   X) echo "159;216;255" ;;
    T) echo "38;38;46" ;;   H) echo "246;244;236" ;;
    R) echo "192;57;43" ;;  D) echo "232;199;102" ;;
  esac
}
draw_panda() {
  local scale="$1"
  local rows=${#SPRITE[@]}
  local i=0
  while [ $i -lt $rows ]; do
    local top="${SPRITE[$i]}"
    local bot="${SPRITE[$((i+1))]:-$top}"
    local line="" cell=""
    local len=${#top}
    local j=0 k=0 v=0
    while [ $j -lt $len ]; do
      local tc="${top:$j:1}"
      local bc="${bot:$j:1}"
      if [ "$tc" = "." ] && [ "$bc" = "." ]; then
        cell=" "
      elif [ "$tc" != "." ] && [ "$bc" != "." ]; then
        cell="$(c "38;2;$(hexcol "$tc")")$(c "48;2;$(hexcol "$bc")")▀$R"
      elif [ "$tc" != "." ]; then
        cell="$(c "38;2;$(hexcol "$tc")")▀$R"
      else
        cell="$(c "38;2;$(hexcol "$bc")")▄$R"
      fi
      k=0; while [ $k -lt "$scale" ]; do line+="$cell"; k=$((k+1)); done
      j=$((j+1))
    done
    v=0; while [ $v -lt "$scale" ]; do echo "  $line"; v=$((v+1)); done
    i=$((i+2))
  done
}
center_line() {
  # $1 = plain text (for width math), $2 = colored text (to print), $3 = total width
  local plain="$1" colored="$2" width="$3"
  local pad=$(( (width - ${#plain}) / 2 ))
  [ $pad -lt 0 ] && pad=0
  printf '%*s%s\n' "$pad" '' "$colored"
}

COLS="$(tput cols 2>/dev/null || echo 80)"
SPRITE_W=${#SPRITE[0]}
SCALE=$(( COLS / SPRITE_W ))
[ "$SCALE" -lt 2 ] && SCALE=2
[ "$SCALE" -gt 4 ] && SCALE=4
BANNER_W=$(( SPRITE_W * SCALE + 2 ))

echo ""
draw_panda "$SCALE"
echo ""
center_line "Mr.Panda" "${B}$(c '38;2;231;76;60')Mr.Panda${R}" "$BANNER_W"
echo ""
echo "${DIM}your desktop research & writing sidekick${R}"
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
