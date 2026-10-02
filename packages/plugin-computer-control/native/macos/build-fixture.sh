#!/usr/bin/env bash
# Builds the test-only fixture app into .build/fixture/MoxxyComputerFixture.app and registers it
# with LaunchServices so the helper can launch it by bundle identifier, like any installed app.
set -euo pipefail
cd "$(dirname "$0")"

APP=.build/fixture/MoxxyComputerFixture.app
swift build -c debug --product ComputerUseFixture
BIN_DIR=$(swift build -c debug --show-bin-path)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/ComputerUseFixture" "$APP/Contents/MacOS/MoxxyComputerFixture"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>ai.moxxy.computer-fixture</string>
  <key>CFBundleName</key><string>Moxxy Computer Fixture</string>
  <key>CFBundleExecutable</key><string>MoxxyComputerFixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
echo "$PWD/$APP"
