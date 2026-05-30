#!/usr/bin/env bash
# Launch the DGEN1 AVD with the host webcam as the back camera, wait for boot,
# then open the app so the webcam feed is live on the scanner screen immediately.
#
# Usage:
#   ./scripts/emulator-webcam.sh [webcam0|webcam1|...]
#
# The app must be installed (run 'npm run android' once first).
# Metro must be running separately: npm start

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

echo "Starting $AVD with back camera = $CAMERA …"
"$EMULATOR" -avd "$AVD" -camera-back "$CAMERA" &
EMULATOR_PID=$!

echo "Waiting for emulator to boot (30–90 s)…"
"$ADB" -e wait-for-device
until [ "$("$ADB" -e shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
done
echo "Boot complete."

# Pre-grant camera permission so the scanner opens directly to the live feed
"$ADB" -e shell pm grant "$APP_PACKAGE" android.permission.CAMERA 2>/dev/null \
  && echo "Camera permission granted." \
  || true

# Launch the app if installed; otherwise open the native camera as a visual check
if "$ADB" -e shell pm list packages 2>/dev/null | grep -q "^package:${APP_PACKAGE}$"; then
  echo "Launching $APP_PACKAGE scanner screen…"
  "$ADB" -e shell am start -n "${APP_PACKAGE}/.MainActivity"
else
  echo "App not installed — run 'npm run android' to build and deploy, then webcam will appear in the scanner."
  "$ADB" -e shell am start -a android.media.action.STILL_IMAGE_CAMERA 2>/dev/null || true
fi

wait "$EMULATOR_PID"
