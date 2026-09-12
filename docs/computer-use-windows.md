# Windows Computer Use

Moxxy's Windows x64 extension owns its native backend. It does not load Codex,
`@oai/sky`, `@oai/cua`, Python, or a separately installed .NET runtime. The helper
is built with MSVC/C++20 and the Windows SDK. macOS continues to use the existing
system-command backend with the same arguments.

## Operating contract

- Windows 10 22H2 and Windows 11 x64 are the intended client targets. Windows
  Server CI does not establish support for either client OS.
- Every operation still uses the tool permission pipeline. UI text is untrusted.
- Enumerate windows, observe or capture the target, act, then observe again.
  The first observation omits `root`/`filter` or passes explicit `null`; never
  fabricate an observation ID. Whole-window screenshots similarly accept
  `region: null`. The extension supplies its own model-facing JSON schemas,
  including numeric/string limits and null alternatives, so older provider SDK
  converters cannot erase those constraints. `unknown-observation` requires a
  fresh unscoped observation, not a focus change.
  Focus is required for physical input, not for window observation. Window IDs
  remain stable within the helper when inventory is refreshed; element IDs are
  observation-scoped. Minimized windows expose null bounds and require `computer_restore`.
  Image coordinates are pixels of the returned image, not desktop coordinates.
- UIA observes a bounded tree or selected observation-scoped subtree and can
  filter by literal name/control type. Output and visited-node limits are separate;
  password controls do not expose text. WGC
  captures a window; visible-screen fallback requires explicit opt-in and may
  include overlapping content. Dispatch success is not evidence of task success.
- A Windows mutex serializes control across processes until the owning turn
  ends. An independent guardian holds a shared injected-input ledger and releases
  it on cancellation, parent exit, watchdog timeout and hard worker termination.
  Only the ledger's releases are sent; physical key state is tracked separately.
  This does not cover failure of the guardian or Windows itself.
- The guardian owns the non-activating Moxxy panel with accessible Pause, Resume
  and Stop buttons. Optional Ctrl+Alt+F11/F10/F12 equivalents register while it is
  visible, when those shortcuts are available. Normal turn cancellation also
  closes the helper. A failed/stopped connection cannot retry input in that turn.
- Native protocol v4 reports local focus waiting, owned dialogs and a scoped permission-focus handshake. Active request deadlines pause
  during explicit waiting, but cancellation remains live. Target focus resumes
  focus-waiting; explicit Pause requires Resume. Resuming returns
  `needs_observation`, with `effect: none | possible`, never replayed input.
- Window inventory reports `ownerWindowId` and `blockingWindowId`. A disabled
  parent's observation excludes owned-dialog controls. Every element carries its
  actual `windowId`; observe the dialog separately before using its controls.
  An action against a disabled parent returns `target_blocked` and the dialog ID
  without delivering input or waiting for impossible parent focus. Nested dialogs
  follow the same contract. Closing a dialog invalidates its references.
- Background `computer_set_value` currently supports verified standard EDIT
  controls through targeted messages. Generic UIA SetValue is **not** assumed
  focus-neutral. Changed values or editability invalidate stored element targets.
- `computer_action` exposes verified UIA patterns: invoke, item selection,
  toggle, expand/collapse and scroll into view. These semantic actions currently
  require foreground access; they never silently fall back to physical clicks.
  Selection/toggle/expansion changes invalidate the stored element. A separate
  MTA executor returns a pending/completed/failed receipt; `computer_action_status`
  checks it without replay. Observation and physical modal closure remain available
  while the provider's invocation is pending. Stop still belongs to the guardian.
- `computer_read_text` reads bounded document/selection text through TextPattern
  or verified native EDIT support. `computer_select_text` selects a literal
  occurrence where a complete control value can be validated. Protected controls
  are excluded. `computer_type_window` supports an observed graphical target
  without requiring an editable element, but still requires identifiable,
  non-protected focus and validates it during typing.
- `computer_app_catalog` enumerates the Windows Shell app catalog and installed
  system Notepad/Paint entries. `computer_open` uses a catalog ID, not a shell
  command, and resolves matching windows by process/application identity.
  Reuse/new-instance requests return explicit existing/opened/ambiguous/no-window
  results. An unavailable catalog source is reported, not treated as an empty one.
- Windows UAC, secure desktops, elevation, Linux and ARM64 are not supported.
  Windows may deny foreground activation. Wait locally for the target or explicit
  Resume; do not repeatedly steal focus or bypass Windows restrictions.
- An optional SDK `computerControl` service exposes live turn snapshots and
  human pause/resume/stop commands. Runner protocol v12 and desktop IPC
  `computer.snapshot` / `computer.control` route by explicit workspace, session
  and turn. Older runners return an update-required error for these operations,
  not for ordinary chat. Stopped transports are never recreated by these commands.
  The desktop chat strip consumes this service only for an active Windows-capable
  turn; stale replies from another workspace/session/turn are not presented as
  controls for the current run. It does not replace the independent native panel.
- Runner protocol v13 adds `computer.approvalFocus`. Before a manual permission
  dialog, the helper records the original target, its geometry/lifetime and the
  requesting desktop process. A one-use approved result can request a single
  OS-governed return only if foreground changes involved that host and target.
  A human visit to another application, changed geometry, denial, pause or Stop
  prevents restoration. No injected shortcut, input-queue attachment or input
  replay is used. A normal Win32 activation can use the verified window's UIA
  focus action if necessary. Before accepting the pending input, the helper
  revalidates the focused control's identity, value, bounds and accessibility
  state. Image coordinates survive only an identical window recapture (same
  pixels, source, size and geometry); a visible-desktop fallback is never reused
  this way. A human focus change during validation still invalidates the result.
  Windows can refuse activation; ordinary safe waiting and fresh-observation
  requirements then remain in force.

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

Seeding still preserves existing extensions. Packaged Windows startup separately
offers a controlled Computer Use update before starting its runners. An existing
installation requires confirmation; the dialog distinguishes changes to a managed
copy from a legacy copy without a verification record. Declining keeps that copy.

The update holds a native maintenance lease, stages the installer package with
private runtime dependencies, rechecks hashes, retains the previous directory,
and probes the installed JavaScript and helper in an isolated process. It updates
only Computer Use's npm pin/lock subtree. Journals recover interrupted activation;
unexpected concurrent file changes require review instead of being overwritten.
Backups remain under `.moxxy/desktop/computer-updates`. No npm/network is needed
to apply the bundled package. Other plugins, vault and chats are not replaced.

Do not delete `.moxxy` or credentials. A local preview still needs the native
artifact in the extension actually loaded by that preview. The controlled startup
offer belongs to full Windows installers, not a JS-only hot update.

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

`-TestInstalledApps` explicitly opts into opening a new Notepad, typing and
reading back a Polish multiline sample, then closing the verified new process
without saving a file. It is separate from tests confined to the fixture.
The guardian panel is tested through actual UI Automation in the fixture probe.

JSON/HTML reports distinguish passed, failed and not-tested. `releaseAccepted`
stays false until the complete acceptance matrix has been independently met.
CI exit 2 means the interactive desktop was unavailable, not a successful GUI test.
The CI wrapper preserves that status in its artifact and warning.

## Release acceptance still required

This branch is not yet the complete acceptance implementation. Outstanding work
includes document opening, cross-window drag, broader background-control support,
handling physical user activity without a focus change, automatic recovery of a
hung semantic provider, and the full fault and agent benchmark matrices.
The built-in panel controls the guardian directly
so Stop does not depend on the desktop renderer. Controlled upgrade tests include
private SDK resolution, refusal without consent, rollback and actual runner discovery;
checkpoint `4d0b1b2b` passed 36 native fixture checks and 35 checks against
installed resources on Windows Server CI, including actual runner discovery and
the controlled upgrade smoke. See [the installer run](https://github.com/moxxy-ai/moxxy/actions/runs/34655804220).
The Windows 10/11 client upgrade path still requires its own acceptance runs.
Do not call the branch release-ready or equivalent to Codex.

Regression checkpoint `7568f60c` additionally verifies the model-facing schema
through the installed Codex provider and runs null-option observation, physical
typing and screenshot through the installed plugin handlers. Both native and
installed-resource suites passed 37 checks on Windows Server, including exact
Polish multiline text in real Notepad. Offline upgrade/discovery also passed in
[the regression installer run](https://github.com/moxxy-ai/moxxy/actions/runs/34665075178).
The earlier red run reproduced unknown-reference misdiagnosis and Notepad focus
waiting; explicit UIA focus now complements SetForegroundWindow. Test setup
establishes the competing fixture's real focus through UIA rather than assuming
process launch activates it. Paint with a real model and Windows 10/11 acceptance
remain unverified. Existing dependency-security advisories remain unresolved.

## Long-text observation crash regression

On 2026-09-12, a direct helper probe on the user's Windows 10 x64 machine
reproduced `0xC0000409` while observing Chrome 152's downloads page. The same
helper could observe the Apollo page (41 elements). An unsaved Notepad document
isolated the boundary: 512 ASCII characters succeeded; appending one character
caused the same crash. These were direct backend tests, not successful agent tasks.

The minidump reported fail-fast subcode 7. Observation truncates each control
value to 512 UTF-16 code units; passing that substring directly to WinRT's
`param::hstring` requires a terminator that the slice does not have. The shared
JSON conversion must materialize an owning `winrt::hstring` first. Keep the
existing size bound and surrogate-pair handling; do not remove truncation or
retry physical input to mask this failure.

Native `json-string-*` tests exercise the real Windows Runtime, including slices,
Unicode, embedded nulls and result lifetime. The portable/installed fixture suite
checks 511, 512, 513 and 4000 code units plus emoji crossing/ending at the cutoff;
it verifies both the bounded response and the unchanged full control value,
and rejection of input exceeding the existing 4000-unit limit without mutation.
The [test-only red run](https://github.com/moxxy-ai/moxxy/actions/runs/34703987275)
failed five slice cases with the original `0xC0000409` before the fix.

After installing a repaired build, repeat Chrome downloads observation, a new
tab/YouTube task, long-text Notepad and Paint through Moxxy itself. When observing
via Moonlight, use windowed/direct mouse mode, read a fresh screenshot after
actions, and do not operate the shared input while Moxxy is executing a task.
Remote operator actions are setup/diagnostics, not proof of Moxxy's agent quality.

## Post-test diagnostics

The owned/nested-dialog fixture failed on the previous contract in
[the red run](https://github.com/moxxy-ai/moxxy/actions/runs/34714839333) and passed
after the generic ownership fix in
[the native verification run](https://github.com/moxxy-ai/moxxy/actions/runs/34715169809).
This is real Windows Server desktop coverage, not a Windows 10 Paint benchmark.

Desktop startup reports a stalled stage after 30 seconds without stage changes;
where a connection snapshot exists, its technical details remain available.
This does not automatically stop work, declare a restart required, or establish
the cause of a previous startup hang.

Shared ReAct `provider_response` events optionally include `timing` with
`contextProjectionMs`, `preparationMs`, `hooksMs`, `firstEventMs`,
`providerWaitMs`, `consumerMs`, and `totalMs`. Waiting includes provider adapter,
network and remote work, **not just model compute**. Consumer time covers local
stream-event handling. First event is not necessarily first text. Total sums
measured stages and excludes tools, approvals, focus waiting, compaction and the
request-event write. Cancellation before the response event may lack this record.
Old events remain valid; replay and provider requests are unchanged. Use the
same model and repeated trials to compare performance, not this metric alone.

## Reference boundary

The locally installed `@oai/cua` 0.2.4 / `@oai/sky` 0.6.26 clients were inspected
to compare addressing and responsibilities: app-bound macOS operations,
Windows app/window identity, separate element and coordinate actions, screenshot
identity/geometry, value operations and secondary accessibility actions. The
Windows native implementation was not available as source in that inspection.
These observations are design references, not copied code or runtime dependencies,
and do not prove the foreground/background behavior of Codex's Windows helper.

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
