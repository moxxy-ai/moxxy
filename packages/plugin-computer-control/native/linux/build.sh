#!/usr/bin/env bash
# Builds the Linux helper for this machine's architecture into bin/linux-<arch>/ with the manifest
# that verifyHelperArtifact checks, and runs the unit tests. Needs the packages listed in the
# Dockerfile next to this script, and the plugin's TypeScript build (dist/) for the manifest writer.
set -euo pipefail
cd "$(dirname "$0")"

PROTOCOL_VERSION=5
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
BUILD=${BUILD_DIR:-build/$ARCH}
OUT=../../bin/linux-$ARCH

cmake -S . -B "$BUILD" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$BUILD" --parallel
ctest --test-dir "$BUILD" --output-on-failure

[ -f "$BUILD/moxxy-computer" ] || exit 0
mkdir -p "$OUT"
cp "$BUILD/moxxy-computer" "$OUT/moxxy-computer.tmp"
mv "$OUT/moxxy-computer.tmp" "$OUT/moxxy-computer"

MANIFEST_WRITER="$(cd ../.. && pwd)/dist/helper/artifact.js"
if [ ! -f "$MANIFEST_WRITER" ]; then
  echo "Build the plugin first: pnpm --filter @moxxy/plugin-computer-control build" >&2
  exit 1
fi
node --input-type=module -e '
import { pathToFileURL } from "node:url";
const [writer, helper, protocol, architecture] = process.argv.slice(1);
const { writeHelperManifest } = await import(pathToFileURL(writer).href);
await writeHelperManifest(helper, { protocolVersion: Number(protocol), os: "linux", architecture });
' "$MANIFEST_WRITER" "$OUT/moxxy-computer" "$PROTOCOL_VERSION" "$ARCH"
echo "Built $OUT/moxxy-computer"
