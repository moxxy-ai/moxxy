# Windows Computer Use

Moxxy's Windows x64 extension owns its native backend. It does not load Codex,
`@oai/sky`, `@oai/cua`, Python, or a separately installed .NET runtime. The helper
is built with MSVC/C++20 and the Windows SDK. macOS continues to use the existing
system-command backend with the same arguments.

## Operating contract

- Windows 10 22H2 and Windows 11 x64 are the intended client targets. Windows
  Server CI does not establish support for either client OS.
- Every operation still uses the tool permission pipeline. UI text is untrusted.
- Enumerate windows, focus one, observe or capture, act, then observe again.
  Window IDs are scoped to a helper/inventory; element IDs to an observation.
  Image coordinates are pixels of the returned image, not desktop coordinates.
- UIA observes a bounded subtree; password controls do not expose text. WGC
  captures a window; visible-screen fallback requires explicit opt-in and may
  include overlapping content. Dispatch success is not evidence of task success.
- A Windows mutex serializes control across processes until the owning turn
  ends. Input is released on cancellation, parent exit and watchdog timeout.
  The native indicator offers Stop Computer Use; normal client cancellation also
  closes the helper. A failed/stopped connection cannot retry input in that turn.
- Windows UAC, secure desktops, elevation, Linux and ARM64 are not supported.
  Windows may deny foreground activation. Ask the user to activate the window;
  do not work around Windows' security or focus rules.

## Distribution and updates

`native/Build-Windows.ps1` builds the helper and fixture, runs native unit tests,
and stages `bin/win32-x64/moxxy-computer.exe` with its protocol/architecture/hash
manifest. This is a developer/CI build script, not a user prerequisite.

The native CI workflow produces a test kit and an optional NSIS installer.
Release publishing must consume the native artifact from the same source commit
before packaging the extension. The binary is a full-installer/extension asset,
not a JS app-update bundle. Startup of other extensions does not require it.
Runtime and Windows resource verification reject missing, mismatched or corrupt
artifacts; a digest is an integrity check, not a replacement for release signing.

Existing user extensions are deliberately **not** overwritten by seeding. After
the version is officially published, explicitly update the Computer Use extension
from Extensions (or `moxxy plugins install @moxxy/plugin-computer-control@VERSION`).
Do not delete `.moxxy`, chats or credentials. Preserve local customizations before
an explicit extension replacement. A local preview also needs the native artifact
in the extension actually loaded by that preview, not just in the repository.

## Local test kit

Extract the `moxxy-computer-use-windows-x64` CI artifact into one directory. It
contains the helper, fixture and `Run-ComputerUseTests.ps1`. Open PowerShell there:

```powershell
powershell.exe -NoProfile -File .\Run-ComputerUseTests.ps1
```

Inspect the script first and start explicitly when prompted. Do not use the mouse
or keyboard while tests run. Test windows belong to the fixture; files go into a
unique temporary report directory. Reports stay local; nothing is uploaded by the
user script. If execution policy blocks the script, use your organization's
approved procedure rather than disabling policy globally.

JSON/HTML reports distinguish passed, failed and not-tested. `releaseAccepted`
stays false until the complete acceptance matrix has been independently met.
CI exit 2 means the interactive desktop was unavailable, not a successful GUI test.
The CI wrapper preserves that status in its artifact and warning.

## Release acceptance still required

Run on both Windows 10 and 11 at 100%, 150% and 200% scaling. Test mixed-DPI
monitors when available; absence of hardware remains not-tested. Native fixture
tests and agent task quality are different measurements. Keep all failed trials.

The opt-in agent benchmark must use the user's selected model with only Computer
Use tools available for GUI tasks, never filesystem or fixture-control shortcuts.
Run each of these three times on each OS: form/save, correcting data, context
menu, scrolling, dragging, modal, two windows, changed layout, delayed control,
canvas-only interaction, editor save/reopen, recovery after focus loss. Judge the
actual fixture/file state, not the agent's report. Require 33/36 successes per OS,
100% of mandatory deterministic checks, and zero out-of-target actions or policy
bypasses. Do not put personal OAuth credentials in CI.

Before release, also verify explicit upgrade from an existing extension, packaged
and development macOS input/capture/clipboard/open/cancellation, real installer
resources, policy-denial paths, forced process termination and stale HWND/element
rejection. Passing current automated tests alone is not a release approval.
