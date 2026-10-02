#!/usr/bin/env bash
# Builds the universal (arm64 + x86_64) macOS helper into bin/darwin-universal/
# with the manifest that verifyHelperArtifact checks (protocol, architecture, digest).
# Needs the plugin's TypeScript build (dist/) for the manifest writer.
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

# The manifest digest ignores code signatures (see helperDigest), so the helper
# still verifies after the desktop packaging signs it again.
MANIFEST_WRITER="$(cd ../.. && pwd)/dist/helper/artifact.js"
if [ ! -f "$MANIFEST_WRITER" ]; then
  echo "Build the plugin first: pnpm --filter @moxxy/plugin-computer-control build" >&2
  exit 1
fi
node --input-type=module -e '
import { pathToFileURL } from "node:url";
const [writer, helper, protocol] = process.argv.slice(1);
const { writeHelperManifest } = await import(pathToFileURL(writer).href);
await writeHelperManifest(helper, { protocolVersion: Number(protocol), architecture: "universal" });
' "$MANIFEST_WRITER" "$OUT/moxxy-computer" "$PROTOCOL_VERSION"
lipo -archs "$OUT/moxxy-computer"
