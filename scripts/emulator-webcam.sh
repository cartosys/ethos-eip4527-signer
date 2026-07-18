#!/usr/bin/env bash
# Launch the DGEN1 AVD with the host webcam as the back camera, wait for full
# UI readiness, then open the app so the webcam feed is live on the scanner.
#
# Prerequisites:
#   - App installed at least once: npm run android
#   - Metro running in a separate terminal: npm start
#
# Usage: ./scripts/emulator-webcam.sh [webcam0|webcam1|...]

set -euo pipefail

EMULATOR="${ANDROID_HOME:-$HOME/Android/Sdk}/emulator/emulator"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
AVD="DGEN1"
CAMERA="${1:-webcam0}"
APP_PACKAGE="com.ethosreferencewallet"

if ! command -v "$EMULATOR" &>/dev/null && [ ! -x "$EMULATOR" ]; then
  echo "emulator not found at $EMULATOR — set ANDROID_HOME or install Android SDK" >&2
  exit 1
fi

# Check that the requested webcam device is present
if [[ "$CAMERA" == webcam* ]]; then
  INDEX="${CAMERA#webcam}"
  DEVICE="/dev/video${INDEX}"
  if [ ! -e "$DEVICE" ]; then
    echo "Warning: $DEVICE not found. Available video devices:" >&2
    ls /dev/video* 2>/dev/null || echo "  none" >&2
  fi
fi

# Warn early if Metro isn't up — app will grey-screen without it
if ! curl -s --connect-timeout 1 http://localhost:8081/status >/dev/null 2>&1; then
  echo "Warning: Metro not detected on :8081 — start it with 'npm start' or the app will show a blank screen." >&2
fi

echo "Starting $AVD with back camera = $CAMERA …"
"$EMULATOR" -avd "$AVD" -camera-back "$CAMERA" &
EMULATOR_PID=$!

# Wait for a stable emulator serial — adb -e can misbehave before the emulator
# registers, and sys.boot_completed=1 fires before the launcher is drawn.
echo "Waiting for emulator to appear in adb devices…"
SERIAL=""
while [ -z "$SERIAL" ]; do
  sleep 2
  SERIAL=$("$ADB" devices | awk '/emulator-[0-9]+\tdevice/{print $1; exit}')
done
echo "Serial: $SERIAL"

echo "Waiting for Android to finish booting…"
until [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
done
# init.svc.bootanim stops only once the launcher is fully drawn — avoids grey screen
until [ "$("$ADB" -s "$SERIAL" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r')" = "stopped" ]; do
  sleep 1
done
echo "Boot complete."

# Pre-grant camera permission so the scanner opens directly to the live feed
"$ADB" -s "$SERIAL" shell pm grant "$APP_PACKAGE" android.permission.CAMERA 2>/dev/null \
  && echo "Camera permission granted." \
  || true

# Launch the app if installed; otherwise open the native camera as a visual check
if "$ADB" -s "$SERIAL" shell pm list packages 2>/dev/null | grep -q "^package:${APP_PACKAGE}$"; then
  echo "Launching $APP_PACKAGE scanner screen…"
  "$ADB" -s "$SERIAL" shell am start -n "${APP_PACKAGE}/.MainActivity"
else
  echo "App not installed — run 'npm run android' to build and deploy, then webcam will appear in the scanner."
  "$ADB" -s "$SERIAL" shell am start -a android.media.action.STILL_IMAGE_CAMERA 2>/dev/null || true
fi

wait "$EMULATOR_PID"
