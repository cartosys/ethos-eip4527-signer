#!/usr/bin/env bash
# Full dev launcher: Metro + webcam emulator + app build/install in one command.
# Ctrl-C shuts everything down cleanly.
#
# Usage: ./scripts/dev.sh [webcam0|webcam1|...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
EMULATOR="${ANDROID_HOME:-$HOME/Android/Sdk}/emulator/emulator"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
AVD="DGEN1"
CAMERA="${1:-webcam0}"
APP_PACKAGE="com.ethosreferencewallet"

if ! command -v "$EMULATOR" &>/dev/null && [ ! -x "$EMULATOR" ]; then
  echo "emulator not found at $EMULATOR — set ANDROID_HOME or install Android SDK" >&2
  exit 1
fi

if [[ "$CAMERA" == webcam* ]]; then
  INDEX="${CAMERA#webcam}"
  DEVICE="/dev/video${INDEX}"
  if [ ! -e "$DEVICE" ]; then
    echo "Warning: $DEVICE not found. Available video devices:" >&2
    ls /dev/video* 2>/dev/null || echo "  none" >&2
  fi
fi

METRO_PID=""
EMULATOR_PID=""

cleanup() {
  [ -n "$METRO_PID" ]    && kill "$METRO_PID"    2>/dev/null || true
  [ -n "$EMULATOR_PID" ] && kill "$EMULATOR_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT"

# Metro and emulator start in parallel — no dependency between them
echo "[dev] Starting Metro…"
npx react-native start --reset-cache &
METRO_PID=$!

echo "[dev] Starting $AVD with back camera = $CAMERA …"
"$EMULATOR" -avd "$AVD" -camera-back "$CAMERA" &
EMULATOR_PID=$!

# Wait for a stable ADB serial before issuing any shell commands
echo "[dev] Waiting for emulator to appear in adb devices…"
SERIAL=""
while [ -z "$SERIAL" ]; do
  sleep 2
  SERIAL=$("$ADB" devices | awk '/emulator-[0-9]+\tdevice/{print $1; exit}')
done
echo "[dev] Serial: $SERIAL"

# sys.boot_completed=1 fires early; bootanim=stopped means the launcher is drawn
echo "[dev] Waiting for Android to finish booting…"
until [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
done
until [ "$("$ADB" -s "$SERIAL" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r')" = "stopped" ]; do
  sleep 1
done
echo "[dev] Boot complete."

# Forward Metro port so the emulator can reach the host bundler
"$ADB" -s "$SERIAL" reverse tcp:8081 tcp:8081

# Pre-grant camera so the scanner opens straight to the live webcam feed
"$ADB" -s "$SERIAL" shell pm grant "$APP_PACKAGE" android.permission.CAMERA 2>/dev/null || true

# Build, install, and launch — run-android handles the am start itself
echo "[dev] Building and installing app (first run ~60 s)…"
npx react-native run-android

# Hold open until the emulator window is closed
wait "$EMULATOR_PID"
