---
'@moxxy/plugin-computer-control': patch
'@moxxy/plugin-stt-whisper-codex': patch
---

Make two flaky tests deterministic.

The screenshot test shelled out to the real macOS `screencapture`, so it needed a display, the host to be macOS, and Screen Recording permission. Worse, it accepted a thrown error as a pass, so on any machine lacking that permission (every CI runner) it verified nothing while still reporting green. The process layer is now faked, so the contract it exists to protect (returning `{ mediaType, base64 }` rather than a stringified blob the model cannot decode) is asserted on every platform, along with the capture-failure, byte-cap, platform-gate and temp-file-cleanup paths that had no cover at all.

The whisper test harness closed its HTTP servers with `close()` alone, which stops new connections but leaves a keep-alive socket holding the callback pending. `closeAllConnections()` now runs first. This is the most likely mechanism behind the occasional "all tests pass, exit 1" on that package, but that failure never reproduced across roughly ten runs and CI, so it is hardening rather than a proven fix.
