#!/usr/bin/env bash
# Builds the universal (arm64 + x86_64) macOS helper into bin/darwin-universal/
# with the manifest that verifyHelperArtifact checks (protocol, architecture, sha256).
set -euo pipefail
cd "$(dirname "$0")"

PROTOCOL_VERSION=5
OUT=../../bin/darwin-universal
ARCHS=(--arch arm64 --arch x86_64)

swift build -c release "${ARCHS[@]}" --product moxxy-computer
BIN_DIR=$(swift build -c release "${ARCHS[@]}" --show-bin-path)

mkdir -p "$OUT"
cp "$BIN_DIR/moxxy-computer" "$OUT/moxxy-computer.tmp"
# Ad-hoc signature with a stable identifier; release signing happens when the desktop app is packaged.
codesign --force --sign - --identifier ai.moxxy.computer-helper "$OUT/moxxy-computer.tmp"
mv "$OUT/moxxy-computer.tmp" "$OUT/moxxy-computer"

SHA=$(shasum -a 256 "$OUT/moxxy-computer" | cut -d' ' -f1)
printf '{"protocolVersion":%d,"architecture":"universal","sha256":"%s"}' "$PROTOCOL_VERSION" "$SHA" > "$OUT/moxxy-computer.json.tmp"
mv "$OUT/moxxy-computer.json.tmp" "$OUT/moxxy-computer.json"
lipo -archs "$OUT/moxxy-computer"
