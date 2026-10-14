#!/usr/bin/env bash
# Regenerate every logo raster from the master picture and copy the shipped
# ones into the apps.
#
#   ./assets/brand/build.sh
#
# The master is a rendered picture, not a vector, so build.py cuts each
# derivative out of it (stdlib Python, no image library). It also prints the
# terminal art; paste that into packages/plugin-cli/src/logo-data.ts.
set -euo pipefail

cd "$(dirname "$0")"
root="$(cd ../.. && pwd)"

python3 build.py moxxy-mark-master.png png

ship() { # ship <png/ file> <repo path>
  cp "png/$1" "$root/$2"
  echo "shipped png/$1 -> $2"
}

# Desktop: the mark every window paints, the app icon (window, Dock,
# installers, favicon, Windows/Linux tray) and the macOS menu-bar template.
ship moxxy-mark-512.png          apps/desktop/public/moxxy-mark.png
ship moxxy-icon-1024.png         apps/desktop/public/logo.png
ship moxxy-mark-template-22.png  apps/desktop/public/trayTemplate.png
ship moxxy-mark-template-44.png  apps/desktop/public/trayTemplate@2x.png
# The blink: the menu bar's closed-eyes frame, and for the sidebar masthead the
# mark without eyes plus where to draw them (BlinkingMoxxyMark).
ship moxxy-mark-template-blink-22.png apps/desktop/public/trayBlinkTemplate.png
ship moxxy-mark-template-blink-44.png apps/desktop/public/trayBlinkTemplate@2x.png
ship moxxy-mark-eyeless-256.png       apps/desktop/public/moxxy-mark-eyeless.png
ship moxxy-mark-eyes.json             apps/desktop/src/components/moxxy-mark-eyes.json
# Mobile: the in-app mark and the opaque app icon (iOS rejects alpha).
ship moxxy-mark-512.png          apps/mobile/assets/moxxy-mark.png
ship moxxy-icon-square-1024.png  apps/mobile/assets/icon.png
ship moxxy-icon-square-1024.png  apps/mobile/ios/MoxxyMobileGateway/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
