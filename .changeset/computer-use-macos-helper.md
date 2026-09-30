---
'@moxxy/cli': patch
---

Computer Use: add the macOS native helper skeleton — a universal (arm64 + x86_64) Swift executable built by `native/macos/build.sh` with a verified manifest. It speaks the shared JSON-lines protocol v5, reports Accessibility and Screen Recording readiness, opens the matching System Settings pane on request, handles pause/stop outside the request queue, and exits when its input closes or the process it serves dies. It is not used by the running tools yet.
