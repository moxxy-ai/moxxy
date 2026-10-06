#!/usr/bin/env bash
# Builds the macOS helper and the fixture app, then runs every test of Computer Use on this Mac:
# the Swift unit tests and the end-to-end tests that drive the real helper against the fixture.
#
# The end-to-end tests use the real pointer and keyboard for a few seconds at a time. Do not touch
# the mouse or keyboard while they run; pass --wait-idle to start them only after 20 s without input.
# The terminal (or the app that runs this script) needs Accessibility and Screen Recording.
set -euo pipefail
cd "$(dirname "$0")/.."

WAIT_IDLE=false
FILTER=""
for arg in "$@"; do
  case "$arg" in
    --wait-idle) WAIT_IDLE=true ;;
    --filter=*) FILTER="${arg#--filter=}" ;;
    *) echo "usage: $0 [--wait-idle] [--filter=<test name pattern>]" >&2; exit 64 ;;
  esac
done

swift test
./build.sh
./build-fixture.sh

if $WAIT_IDLE; then
  echo "Waiting for 20 s without mouse or keyboard input…"
  until [ "$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')" -ge 20 ]; do sleep 2; done
fi

cd ../..
if [ -n "$FILTER" ]; then npx vitest run src/macos/helper.test.ts -t "$FILTER"
else npx vitest run src/macos/helper.test.ts; fi
