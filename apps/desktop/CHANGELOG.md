# @moxxy/desktop

## 0.15.0

### Minor Changes

- 4bdd6f8: feat(desktop): migrate legacy NDJSON-only chats into the runner's authoritative log

  The keystone of the dual-history consolidation: make the runner's session log the
  home of EVERY chat, including ones whose history previously lived only in the
  desktop's NDJSON mirror (localStorage-migrated / pre-runner-session chats). Without
  this, continuing such a chat would strand its old history in NDJSON while new turns
  go to the runner log — a split the per-slot single-source renderer can't show.

  - `@moxxy/core` gains `seedSessionLog(sessionId, events, dir?)` — writes a fresh
    session JSONL from an event list IFF the session has none yet (idempotent;
    never overwrites a session the runner already owns), re-sequenced to contiguous
    `seq` 0..n-1 with ids/content preserved and written temp+rename.
  - The desktop runner pool seeds a workspace's session from its NDJSON mirror
    (`seedChatIntoSession`) BEFORE that workspace's runner resumes its session id,
    so the seed is in place when the runner reads it (race-free) and only for chats
    actually opened. Best-effort and non-destructive — the NDJSON store is left
    intact and remains the read fallback.

  This unblocks (and is a prerequisite for) the deferred follow-ups — stopping the
  NDJSON double-write, raising the desktop FLOOR to v10, and retiring the NDJSON
  store — each of which is a separate PR gated on packaged-desktop live-verify.

### Patch Changes

- 021d868: Preferences → Update: align the section with the Appearance row — the app version sits on the left and the single Update action on the right. The runner version, its on-disk path, and the boot-log diagnostics now live behind a "Get more details" disclosure so the resting card is one calm "App version + Update" line.
  - @moxxy/cli@0.14.3
  - @moxxy/desktop-host@0.7.7
  - @moxxy/runner@0.2.13
  - @moxxy/ipc-server-ws@0.1.24
  - @moxxy/plugin-channel-mobile@0.1.25

## 0.14.1

### Patch Changes

- 679049e: fix(desktop): build the macOS app as a universal binary (x86_64 + arm64)

  The macOS installers were arm64-only, so Intel Macs — including many still on
  Sonoma/Ventura/Monterey — could not launch the app at all (an arm64-only binary
  cannot run on Intel; Rosetta only translates x86→arm). The mac `build.target`
  now requests `arch: ["universal"]` for both the dmg and zip, producing a single
  `moxxy-desktop-<v>-universal.{dmg,zip}` that runs on both architectures.

  Supporting changes that were required for the universal merge to succeed and for
  all native features to work on Intel:

  - `build/after-pack.cjs` no longer ad-hoc signs the per-arch staging dirs
    (`mac-universal-*-temp`); signing them before the merge makes their
    `_CodeSignature` diverge and `@electron/universal` aborts. It now signs the
    merged universal app instead.
  - `mac.x64ArchFiles` whitelists the single-arch native binaries the app bundles
    (sharp, @napi-rs/canvas, onnxruntime-node, node-pty, keyring) so the merge
    keeps them as-is while still lipo-merging the compiled `node-pty` addon.
  - Root `pnpm.supportedArchitectures` installs both x64 and arm64 builds of the
    platform-split native deps (sharp / canvas / keyring), so each architecture
    loads its matching binary at runtime instead of degrading on Intel.

  Also declares `minimumSystemVersion: 11.0.0` so Catalina (10.15) and older show
  a clean "requires macOS 11" message (Electron 33's floor) instead of a confusing
  launch failure.

## 0.14.0

### Minor Changes

- 524a367: feat(desktop): read chat history from the runner's authoritative log (NDJSON kept as fallback)

  The desktop renderer now reads transcript history from the runner instead of its
  own NDJSON store, completing the renderer half of the dual-history consolidation
  (the runner v10 `session.loadHistory` foundation shipped separately).

  - New IPC `chat.loadHistory` proxies to the workspace's connected `RemoteSession`
    (`session.loadHistory`, protocol v10). It returns `null` — so the renderer
    falls back to the existing `chat.loadSegment` NDJSON path — whenever the runner
    can't serve it: no connected runner for the workspace, a `<v10` runner (the
    version gate throws), or a legacy-only chat that exists solely in
    `~/.moxxy/chats`. No transcript ever goes blank.
  - `ChatPersistence.loadHistory` + a chat-store "page-until-K-rendered" cursor:
    the runner returns RAW events (including non-rendered `assistant_chunk`/
    provider bookends), so the store walks several raw pages and filters with
    `isRenderedEvent` until it has a full window of rendered rows. The history
    source (runner `seq` cursor vs NDJSON line-index cursor) is decided once per
    slot and never mixed; if the runner drops mid-scroll the slot stays resumable
    rather than switching cursor spaces.
  - Legacy completeness: a session whose runner log predates the seal feature can
    hold a turn that streamed text then errored/aborted with no `assistant_message`.
    The runner-read projection reconstructs that reply (mirroring the runner's own
    seal) so it is never silently dropped — but only for turns the runner never
    sealed, so a post-seal errored turn is not doubled.
  - A GOLDEN render-equivalence test pins that the runner-read projection
    reconstructs the EXACT same transcript as the legacy NDJSON path — its ground
    truth is built by an independent pass of the real live reducer (not by
    re-applying the projection), across sealed, unsealed (reconstructed),
    errored-then-sealed (not doubled), reasoning, tool, plugin, compaction, and
    multi-page fixtures.

  The renderer still WRITES NDJSON (the double-write), so it remains a working read
  fallback and the home of legacy-only chats. Stopping the double-write and
  physically retiring the NDJSON store are deferred follow-ups, gated on a v10
  floor and packaged-desktop live-verify.

## 0.13.1

### Patch Changes

- 389c2c8: Desktop: collapse the three separate update controls (Update CLI, Update
  dashboard, Update app) into ONE "Update" button. A single action now brings both
  the runner (`@moxxy/cli`, restarts live) and the desktop app (hot-update bundle,
  or full installer when a hot-update can't deliver) to the latest version
  together. The settings panel shows both versions; the runner update is non-fatal
  (the bundled CLI keeps working if npm isn't available). No update-engine or IPC
  changes — the existing primitives are just composed behind one `runUpdateAll`.
- Updated dependencies [389c2c8]
  - @moxxy/client-core@0.8.6
  - @moxxy/client-platform-web@0.1.23

## 0.13.0

### Minor Changes

- 5ed2671: feat(desktop): redesign the document anonymizer as a guided import → settings → output flow

  Simpler, clearer UX: a three-stage layout (Import / Settings / Output). Import has
  an Upload-vs-Paste toggle with a friendly drag-drop dropzone + file picker; Settings
  puts the redaction categories in a proper multi-select dropdown (checkboxes + All/None)
  alongside the mode control and custom terms; Output shows per-category counts with
  Copy + Save. The offline engine, on-device NER, document parsing, and the bytes-not-path
  drag-drop security model are unchanged.

### Patch Changes

- 0941b8d: feat(desktop): agent showcases its work in the rail + Preferences tab

  **Agent opens the sidebar.** When the agent drives the browser (`browser_session`)
  or the terminal (`terminal`), the matching Context-rail pane now opens on its own
  so the user sees the work as it happens — no need to open the pane manually. It's
  renderer-only (it watches the existing `runner.event` stream and reveals the pane),
  reveals each pane at most once per session, and never auto-closes — the rail's
  close button stays authoritative.

  **Preferences tab.** The "Appearance" and "About" settings tabs are folded into a
  single **Preferences** tab (theme + version/update + CLI), so there's one place for
  "how the app looks and updates".

  Also adds the previously-missing regression test for the browser region-capture →
  chat-attach flow.

## 0.12.6

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/runner@0.2.12
  - @moxxy/cli@0.14.3
  - @moxxy/desktop-host@0.7.6
  - @moxxy/ipc-server-ws@0.1.23
  - @moxxy/plugin-channel-mobile@0.1.24

## 0.12.5

### Patch Changes

- @moxxy/desktop-host@0.7.5
- @moxxy/cli@0.14.2
- @moxxy/runner@0.2.11
- @moxxy/ipc-server-ws@0.1.22
- @moxxy/plugin-channel-mobile@0.1.23

## 0.12.4

### Patch Changes

- 558e299: fix(surfaces): sharper, smoother in-window browser + region-capture-to-chat

  **Sharpness.** The live view was blurry on HiDPI/Retina displays — it streamed a
  1× JPEG (quality 55) that the browser then upscaled into a 2× pane. The Playwright
  context now renders at `deviceScaleFactor: 2` and frames use JPEG quality 70, so
  text is crisp.

  **Less lag.** The poll interval dropped 450ms → 300ms (the `inFlight` guard still
  prevents pile-up), on top of the existing burst-frame-after-each-interaction.

  **Region capture → chat input (replaces element-pick).** The toolbar's selector
  button is now "Capture a region": drag a box over any part of the page and a sharp
  PNG of exactly that area is attached to the chat composer (with a "📎 added to the
  chat input" confirmation). You then describe the change and send — the agent SEES
  the pixels. This is more robust and usable than the old CSS-selector pick: it works
  for any content, not just DOM elements, and rides the normal attach→send flow. New
  sidecar `capture` method (clipped screenshot).

  - @moxxy/cli@0.14.2

## 0.12.3

### Patch Changes

- 7a43879: fix(desktop): header nav collapsed even on wide windows; remove white-background brand GIF

  - **Header nav stuck collapsed.** The responsive `Segmented` collapse (shipped in
    0.12.0) folded the nav groups into dropdowns even on wide screens. Once
    collapsed, the live pill row unmounted, so the fit-measurer lost the natural
    width and the container shrink-wrapped the small collapsed button — `available`
    looked tiny and it could never tell it would fit again, so any transient narrow
    moment (window opening, a resize) wedged it collapsed forever. Fixed by keeping
    the inline row ALWAYS mounted as a hidden measuring layer at its natural width
    inside a shrinkable, clipping box: the fit check now reads the true natural vs.
    available width whether or not it's collapsed, so it collapses only when the row
    genuinely doesn't fit and re-expands the instant room returns.
  - **Removed the white-background brand GIF** (`new-animation.gif`) — its white
    matte can't be keyed out on the dark theme. Every use now points at the existing
    transparent static `logo.png`; the CSS bob animation is preserved.

- 7a43879: fix(desktop): robust PDF text extraction for the anonymizer + Office-doc previews in the Files pane

  - **Anonymizer "Could not extract text from this document" on real PDFs.**
    officeparser's stale bundled pdf.js silently returns an EMPTY string for many
    ordinary text-layer PDFs, surfacing as a generic extraction failure. PDF
    extraction now runs through `pdfjs-dist` (pure-JS, offline, in the main
    process — no native deps, no network): it concatenates every page's text
    layer AND pulls AcroForm field values (fillable personal-details forms keep
    their data in form fields, not the content stream). officeparser remains a
    fallback only when pdfjs cannot open the file. A genuinely image-only /
    scanned PDF (no text layer, no form fields) now gets a clear "looks like a
    scanned image — needs OCR" message instead of a blank failure.
  - **Files explorer preview for Office/ODF docs.** `.docx`/`.xlsx`/`.pptx`/
    `.odt`/`.ods`/`.odp`/`.rtf`/`.doc` opened in the Files pane now preview as
    their EXTRACTED text rather than the confirm-gated "binary file" prompt that
    would only ever show garbled zip bytes. (Images and PDFs already preview
    natively — `<img>` and Chromium's PDF viewer — via the existing image/pdf
    `workspace.readFile` branches.)

- Updated dependencies [cbf115b]
- Updated dependencies [cbf115b]
- Updated dependencies [7a43879]
  - @moxxy/sdk@0.15.0
  - @moxxy/cli@0.14.2
  - @moxxy/desktop-host@0.7.4
  - @moxxy/chat-model@0.2.4
  - @moxxy/client-core@0.8.5
  - @moxxy/client-platform-web@0.1.22
  - @moxxy/desktop-ipc-contract@0.9.4
  - @moxxy/ipc-server-ws@0.1.21
  - @moxxy/plugin-channel-mobile@0.1.22
  - @moxxy/plugin-stt-whisper-codex@0.0.23
  - @moxxy/plugin-vault@0.0.23
  - @moxxy/runner@0.2.10
  - @moxxy/workflows-builder@0.1.11

## 0.12.2

### Patch Changes

- f22a2b2: feat(surfaces): browser zoom + "select element for the agent"; redesigned Collaborate start

  **Browser zoom.** ⌘+ / ⌘− / ⌘0 (and toolbar buttons) zoom the page in the
  in-window browser (CSS `zoom` via a new sidecar `zoom` method), intercepted so
  they zoom the page rather than the whole desktop app.

  **Select an element for the agent.** A new "select element" toggle lets you click
  any element on the page; the sidecar's `pick` method resolves a best-effort CSS
  selector + text snippet, and a bar appears where you describe a change ("make it
  blue") and hit **Ask agent** — which tasks the session (`session.runTurn`) to
  change that element via the browser tool. Aimed at the localhost dev loop
  ("change this XXX to YYY").

  **Collaborate tab.** Redesigned the "Start a collaboration" empty state: a proper
  composer card (focus ring, ⌘↵ to start, primary action) plus quick-start example
  chips, replacing the bare input + button.

  - @moxxy/cli@0.14.1

## 0.12.1

### Patch Changes

- 82b8be9: feat(surfaces): interactive in-window browser + richer file preview

  **Browser — a genuinely interactive, full-bleed view.** The live view now behaves
  like a real browser: click / double-click, hover (`:hover` styles + tooltips via
  pointer move), scroll, full keyboard incl. modifier shortcuts, and
  back/forward/reload — with a snappier refresh that bursts a fresh frame after each
  interaction. The page viewport is resized to the pane (`surface.resize` →
  `setviewport`) so the view fills the whole container instead of being letterboxed,
  and clicks map 1:1. The install/loading states are on-brand (spinner, primary
  Button, indeterminate progress bar, condensed progress line) instead of dumping
  raw npm output.

  **Files — preview opens far more types.** Images and PDFs render inline (PDF via
  Chromium's viewer in a `blob:` iframe — `frame-src blob:` added to the CSP);
  text/code open directly; binary-looking or very large files prompt before opening
  as text (a huge blob in a `<pre>` can crash the renderer). `workspace.readFile`
  gained a discriminated result (`kind: text | image | pdf | confirm` plus
  `mediaType` / `base64` / `reason` / `byteLength`) and a `force` flag, and reads
  only a head window via a file handle so a multi-GB file never loads whole.

- 43d3874: Security + correctness audit of the newly-merged features (collab / anonymizer / mini-apps)

  Applied the quality sweep to the features that landed during it. Real bugs fixed,
  each with a regression test:

  - **mode-collaborative (security, high):** path-traversal / arbitrary-file-read in
    the peer-read confinement — a `startsWith(dir)` prefix check let a peer agent
    read sibling-dir files outside its worktree. Replaced with segment-aware
    containment (`resolve`+`relative`). Also fixed abort-listener leaks in the poll
    loops.
  - **plugin-collab (security/correctness):** `boardRelease`/`boardClaim` by public
    id skipped the owner check (lock-stealing + ownership-hijack across peers), and
    a crashed agent's file locks were never freed (deadlock). Ownership now enforced
    on the id path; crashed/killed agents release their claims.
  - **anonymizer (security/perf):** NER span aggregation mislocated short entities
    (a **PII-leak** — redacted the wrong region, left real PII), the worker leaked
    in-flight promises on teardown/error, and overlap resolution was O(n²). Fixed.
  - **app installer (security):** the asset download had no source allow-list (SSRF)
    and no size cap (disk-fill DoS); both added. The `moxxy-app://` protocol handler
    was audited and confirmed escape-proof.
  - mini-apps framework + collaborate UI: worker-leak fix, IPC boundary Zod test
    coverage, and extracted/tested pure render helpers.

- Updated dependencies [82b8be9]
- Updated dependencies [43d3874]
  - @moxxy/desktop-host@0.7.3
  - @moxxy/desktop-ipc-contract@0.9.3
  - @moxxy/cli@0.14.1
  - @moxxy/client-core@0.8.4
  - @moxxy/ipc-server-ws@0.1.20
  - @moxxy/plugin-channel-mobile@0.1.21
  - @moxxy/client-platform-web@0.1.21

## 0.12.0

### Minor Changes

- 2673fa0: Wire the desktop Providers reasoning-effort selector live: it now maps onto the runner's `config.context.reasoning` instead of dead-ending in localStorage. Adds a `session.setReasoning` runner protocol method (v9) + a `settings.setReasoning` IPC command, surfaces `supportsReasoning` on `ProviderEntry` (derived from the runner's model catalog) so the selector only renders where it's honored, and removes the unchecked `(p as { supportsReasoning? })` cast.

### Patch Changes

- 72d89f3: fix(desktop): anonymizer NER runs fully offline + reads every common document type

  Two fixes to the offline document anonymizer:

  - **ORT wasm backend no longer hits a CDN.** The NER model failed with
    `no available backend found … Failed to fetch … cdn.jsdelivr.net/…/ort-wasm-simd-threaded.jsep.mjs`:
    transformers.js / onnxruntime-web resolved its WASM runtime glue from jsdelivr
    by default, which broke the offline guarantee and failed outright (CSP-blocked /
    offline). The onnxruntime-web artifacts (`ort-wasm-simd-threaded.jsep.{mjs,wasm}`)
    are now shipped as part of the app shell (copied from `@huggingface/transformers`
    into the renderer build at `/ort/`, served from the app's own origin in dev,
    loopback, and `file://`), and the worker pins `env.backends.onnx.wasm.wasmPaths`
    at that local base before the ORT session is created — nothing is fetched from a
    CDN. The renderer CSP already permits this (it all rides on `'self'`); no real
    network origin was opened.

  - **Reads all common document types.** The anonymizer now accepts PDF, Word
    (`.doc`/`.docx`), RTF, OpenDocument (`.odt`/`.ods`/`.odp`), spreadsheets,
    slides, and plain text. PDF/Office/ODF go through the existing officeparser
    pipeline; legacy binary `.doc` and `.rtf` (which officeparser doesn't handle)
    get dependency-free local extractors in a shared `parseBufferToText` core (so
    chat attachments benefit too). The "Open document" pane also accepts
    drag-and-drop: the renderer reads the dropped file's BYTES (which it already
    holds — no filesystem access) and sends them to a new host-only
    `anonymizer.parseDocumentBytes` IPC for extraction. It deliberately sends bytes
    rather than a path, so a compromised renderer can't forge a path to read an
    arbitrary file — the picker's provenance gate (which guards `parseDocument`)
    stays the only way main ever opens a renderer-named path. Everything stays
    local — no provider, runner, or network.

- 72d89f3: fix(desktop): stop the `moxxy-app://` scheme registration from crashing hot-updates (0.10 → 0.8 downgrade)

  The Apps feature registered its `moxxy-app://` privileged scheme with a
  top-level `protocol.registerSchemesAsPrivileged` call in the hot-updatable
  `index.ts`. Electron only honors that API **before** `app` is ready, but the
  immutable bootstrap loads the real main via `import()` **after** `whenReady` —
  so every hot-updated bundle threw `"protocol.registerSchemesAsPrivileged should
be called before app is ready"` on load, got poisoned, and reverted to the baked
  floor. Observed live as a 0.10.0 → 0.8.x downgrade.

  - Register the privileged scheme in the bootstrap's synchronous pre-ready
    prologue (the one place guaranteed to run before ready); the privileges are
    single-sourced in a new `app-scheme` module so the bootstrap and `index.ts`
    can't disagree. The call in `index.ts` is now a defensive no-op post-ready, so
    a new override no longer crashes even on an already-installed older bootstrap.
  - Pruning after staging now also keeps the last `confirmed` bundle — the exact
    rollback target `recoverFromFailedBoot` needs — so a genuinely failed boot
    rolls back to the last-good override instead of falling all the way to the
    floor.

- 2673fa0: Quality sweep: close the last deferred audit items

  - **`RequirementChecker.targetInfo`** is now table-driven (`TARGET_DESCRIPTORS`
    record, byte-identical to the old per-kind switch, with compile-time
    exhaustiveness). Closes the types-generics-5 table-drive item.
  - **Voice-admin** is extracted into a first-class `@moxxy/plugin-voice-admin`
    package (tools moved verbatim, registered via the cli builtin entries like the
    other plugins). Closes u28-3.
  - **Reasoning-effort** is now wired end to end: the desktop Providers selector
    flows through a typed IPC command to the runner's `config.context.reasoning`
    (runner protocol bumped to v9 in lockstep with the desktop floor), instead of
    persisting to local state and silently doing nothing. Closes the long-standing
    reasoning TODO (audit c15 / R1).

- Updated dependencies [72d89f3]
- Updated dependencies [2673fa0]
- Updated dependencies [72d89f3]
- Updated dependencies [2673fa0]
  - @moxxy/desktop-ipc-contract@0.9.2
  - @moxxy/desktop-host@0.7.2
  - @moxxy/client-core@0.8.3
  - @moxxy/cli@0.14.0
  - @moxxy/ipc-server-ws@0.1.19
  - @moxxy/plugin-channel-mobile@0.1.20
  - @moxxy/client-platform-web@0.1.20

## 0.11.1

### Patch Changes

- 50a5b38: Quality sweep finalize: desktop side of the @moxxy/sdk ./server subpath split

  The desktop main process (ws-bridge + host modules) now imports Node-only SDK
  helpers from `@moxxy/sdk/server` rather than the main barrel, matching the
  boundary the dep-cruiser `no-node-builtins-in-renderer` rule now enforces. No
  behavior change.

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/cli@0.13.2
  - @moxxy/chat-model@0.2.3
  - @moxxy/client-core@0.8.2
  - @moxxy/client-platform-web@0.1.19
  - @moxxy/desktop-host@0.7.1
  - @moxxy/desktop-ipc-contract@0.9.1
  - @moxxy/ipc-server-ws@0.1.18
  - @moxxy/plugin-channel-mobile@0.1.19
  - @moxxy/plugin-stt-whisper-codex@0.0.22
  - @moxxy/plugin-vault@0.0.22
  - @moxxy/runner@0.2.9
  - @moxxy/workflows-builder@0.1.10

## 0.11.0

### Minor Changes

- f8b0c63: feat(collaborative): launch collaborations from the Collaborate tab; one at a time

  Collaboration is no longer started as a chat mode (any chat in a workspace could
  have kicked one off, clobbering the same repo's worktrees). It is launched from
  the Collaborate tab, and only ONE runs at a time across the app to save
  resources.

  - **Global single-flight lock** (`~/.moxxy/collab/active.lock`, cross-process,
    with dead-pid reclaim): the coordinator acquires it before a run and refuses a
    second with a clear message; released in `finally`.
  - **Collaborate tab Start composer** — type a goal → it sets the active
    workspace's session to collaborative mode and runs it; a `＋ New` affordance
    after a run finishes. A new read-only `collab.active` IPC lets the tab disable
    Start (with a notice) while a collaboration runs in any workspace.
  - **Removed from the chat mode pickers** — `collaborative` and the internal
    `collab-architect`/`collab-peer` modes no longer appear in the desktop
    AgentPicker or the TUI `/mode` picker; `/mode collab*` points to `/collab`.
  - chat-model: a refused start no longer leaves an empty collaboration block.

### Patch Changes

- Updated dependencies [f8b0c63]
  - @moxxy/chat-model@0.2.2
  - @moxxy/desktop-ipc-contract@0.9.0
  - @moxxy/desktop-host@0.7.0
  - @moxxy/cli@0.13.1
  - @moxxy/client-core@0.8.1
  - @moxxy/ipc-server-ws@0.1.17
  - @moxxy/plugin-channel-mobile@0.1.18
  - @moxxy/client-platform-web@0.1.18

## 0.10.0

### Minor Changes

- c058735: feat(desktop): Apps gallery with install lifecycle + offline document anonymizer

  Adds an **Apps** section (a new top-level header tab next to Chat / Workflows) — a
  registry-backed gallery of self-contained mini-applications. Apps that need local
  assets show a predefined **Install** step that downloads everything they need
  before first use; installation is the only time the network is touched, runs in
  the main process, and is gated behind an explicit click.

  The first app is an **offline document anonymizer**. Paste text or open a
  document (PDF / Office / text, parsed locally via the existing officeparser
  pipeline) and it detects + redacts PII — emails, phone numbers, credit cards
  (Luhn), SSNs, IPs, MACs, IBANs (mod-97), URLs — plus a custom-terms list and an
  **on-device NER** model (`Xenova/bert-base-NER`, ~109 MB, downloaded on install)
  for names, organizations and locations. Redaction runs entirely in the renderer
  (`@moxxy/anonymizer`, a new pure, dependency-free, network-free engine) with
  labeled / pseudonym / hash styles. **Documents never leave the machine**: the
  analyze path touches no provider/runner/network, the CSP `connect-src` stays
  local-only (the NER model is served from a confined `moxxy-app://` scheme over
  `userData/moxxy-apps`), and the engine's emptiness of dependencies is enforced by
  a unit test.

### Patch Changes

- Updated dependencies [c058735]
  - @moxxy/anonymizer@0.1.0
  - @moxxy/desktop-ipc-contract@0.8.0
  - @moxxy/desktop-host@0.6.0
  - @moxxy/client-core@0.8.0
  - @moxxy/ipc-server-ws@0.1.16
  - @moxxy/plugin-channel-mobile@0.1.17
  - @moxxy/client-platform-web@0.1.17
  - @moxxy/cli@0.13.1

## 0.9.1

### Patch Changes

- 897a1fc: Quality sweep, wave 7 (review long-tail triage — final cluster)

  Triaged the audit's low-severity review long-tail: fixed the genuine
  correctness/robustness items (each behavior-preserving + a regression test) and
  consciously declined the subjective/stale nitpicks with a recorded rationale.

  Representative fixes: OAuth `countTokens` now refreshes a near-expiry token
  (was silently degrading to the estimate); desktop `ConnectionScreen` handles a
  rejected (not just `{ok:false}`) update promise and names the real cause;
  `BrowserPane` `preventDefault`s the keys it forwards; `useStepFlow` pins the
  cursor to the shown step id so a late-applying step can't bounce the user; plus
  assorted small robustness fixes across core/cli/plugins. Also replaced bare
  `Function`-typed test casts with proper signatures (net lint improvement).

  This is the last audit cluster — every finding in
  `.claude/audits/quality-sweep-findings.json` is now either fixed or consciously
  resolved with a rationale.

- Updated dependencies [897a1fc]
- Updated dependencies [897a1fc]
  - @moxxy/workflows-builder@0.1.9
  - @moxxy/runner@0.2.8
  - @moxxy/plugin-vault@0.0.21
  - @moxxy/sdk@0.14.4
  - @moxxy/cli@0.13.1
  - @moxxy/client-core@0.7.1
  - @moxxy/desktop-host@0.5.7
  - @moxxy/ipc-server-ws@0.1.15
  - @moxxy/plugin-stt-whisper-codex@0.0.21
  - @moxxy/chat-model@0.2.1
  - @moxxy/desktop-ipc-contract@0.7.6
  - @moxxy/plugin-channel-mobile@0.1.16
  - @moxxy/client-platform-web@0.1.16

## 0.9.0

### Minor Changes

- 27bfaf6: feat(collaborative): agentic collaborative mode — a team of separate agents working in parallel

  A new selectable `collaborative` mode runs a _team_ of full, **separate** agent
  runner processes on one task (instead of in-process subagents). An **architect**
  agent designs the plan + shared **contracts** and proposes the roster (you
  approve/adjust); **implementer** agents then build in parallel, each in its own
  git **worktree**, coordinating over a new cross-process **collaboration hub**:

  - **`@moxxy/plugin-collab`** — the hub: a unix-socket message bus, a task board
    that doubles as an exclusive **file-lock** arbiter, a **contract registry**
    (publish → propose-change → ack → commit), **peer-read** (one agent reads
    another's in-progress files), crash detection, and **human step-in**
    (pause / resume / directive) — plus the peer `collab_*` tools and the
    `/collab_say` `/collab_direct` `/collab_pause` `/collab_resume` commands.
  - **`@moxxy/mode-collaborative`** — the coordinator (`collaborative`) + the
    internal `collab-architect` / `collab-peer` modes, the peer-process supervisor,
    the git worktree + **staged, ownership-resolved merge** engine (the user's
    branch is only advanced on a clean, atomic promote; conflicts never leave
    markers), and a user-configurable `CollabConfig`. Falls back to a **sequential
    single-workspace** run when git is unavailable (e.g. desktop users without git).
  - **`moxxy agent`** — an internal headless peer-runner subcommand.
  - **UI** — a folded `CollaborationBlock` in `@moxxy/chat-model`; an inline
    team-summary card in chat; and a dedicated **Collaborate** desktop workspace
    (agents · tasks · contracts rail, a `# All` / `@agent` channel selector, and a
    step-in composer) plus a compact TUI `collab` view.

  No runner-protocol bump (the hub has its own versioned protocol; collaboration
  events ride the existing `plugin_event` stream).

### Patch Changes

- 0c86701: fix(surfaces): make the terminal a real PTY + offer to install the browser engine

  **Terminal — the root cause it never accepted input.** node-pty ships its macOS
  `spawn-helper` binary without the executable bit, and several install/repack
  paths (npm into the desktop's CLI prefix, pnpm's content store) keep it that way.
  node-pty then loads fine but `pty.spawn` throws `posix_spawnp failed`, which was
  silently swallowed into the piped fallback — a shell with no TTY line discipline,
  so a viewer's Enter (`\r`) never reaches it and nothing echoes. The pane looked
  alive (it showed a prompt) but ignored every keystroke. This affected dev and
  packaged builds alike, which is why earlier UI/sizing/ref-count fixes didn't
  help. Fix: `pty.ts` now repairs the `spawn-helper` exec bit before spawning and
  retries once; the installer chmods it after `npm install` too. When a real PTY
  genuinely can't start, the pane shows an honest "Terminal unavailable" status
  instead of a silently-dead box.

  **Browser — offer to install Playwright instead of erroring.** When the
  `playwright` npm package is missing, the browser surface now reports a distinct
  `needs-install` state and shows an **Install browser engine (~200MB)** button.
  On click it installs the npm package + the Chromium engine with live progress in
  the pane, restarts the sidecar, and resumes — no manual `npm i playwright` in the
  install dir.

- Updated dependencies [27bfaf6]
- Updated dependencies [0c86701]
  - @moxxy/cli@0.13.0
  - @moxxy/chat-model@0.2.0
  - @moxxy/client-core@0.7.0
  - @moxxy/desktop-host@0.5.6
  - @moxxy/client-platform-web@0.1.15

## 0.8.9

### Patch Changes

- 5f20dab: Quality sweep, wave 6 (god-file decomposition — atomic modules)

  Behavior-preserving structural refactor: the largest god-files are split into
  focused, single-responsibility sibling modules and re-exported from their
  original paths, so every existing import and the public API are byte-identical
  (verified by typecheck + check:deps + the existing test suites).

  - runner: `RemoteSession` (1145→789 LOC) → per-surface `client-views/*`;
    `RunnerServer` (781→509 LOC) → per-domain `handlers/*`. Wire protocol unchanged.
  - `@moxxy/sdk`: `mode-helpers.ts` (797 LOC) → `mode/{project-messages,collect-stream,single-shot,stuck-loop,stable-hash}.ts`, barrel exports byte-identical.
  - plugin-workflows DAG executor, plugin-webhooks tools, plugin-self-update
    core-tools split into per-concern/per-tool modules.
  - desktop: electron `main/index.ts`, `WorkflowCanvas.tsx` (→ `canvas-graph` +
    camera/drag hooks), `Composer.tsx` decomposed; pure helpers now unit-tested.
  - `desktop-ipc-contract` barrel split into per-domain files (re-exported).
  - cli `setup/builtins.ts` + `setup/workflows.ts` decomposed into composables.
  - core `PluginHost` registration/unregistration is now driven by one
    `REGISTRY_KINDS` table (was 2 parallel hardcoded 16-entry lists); shared
    `PluginHostOptions` extracted to a leaf to keep the host/table dependency
    one-directional (no import cycle).

  Cross-package moves (e.g. relocating voice tools to a new package) were
  deferred — they change package boundaries and belong in their own PRs.

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/cli@0.12.8
  - @moxxy/chat-model@0.1.5
  - @moxxy/client-core@0.6.5
  - @moxxy/desktop-host@0.5.5
  - @moxxy/desktop-ipc-contract@0.7.5
  - @moxxy/ipc-server-ws@0.1.14
  - @moxxy/plugin-channel-mobile@0.1.15
  - @moxxy/plugin-stt-whisper-codex@0.0.20
  - @moxxy/plugin-vault@0.0.20
  - @moxxy/runner@0.2.7
  - @moxxy/workflows-builder@0.1.8
  - @moxxy/client-platform-web@0.1.14

## 0.8.8

### Patch Changes

- e070b38: feat(desktop): Files explorer in the context rail

  Adds a **Files** option to the context-rail dropdown — a workspace file explorer
  that browses the full directory tree and previews any file's contents (via
  `workspace.readFile`). Unlike the existing **Files changed** option, it is always
  available (no git repo required) so you can read/preview workspace files in any
  project. Clicking a file opens the shared menu to Add it to the agent or Open it
  in the viewer.

  The click menu + list chrome shared by the two file panes are factored out into
  `FilePaneShared.tsx` so "Files changed" and "Files" can't drift apart.

- ff73468: Quality sweep, wave 5 (safe longtail — coverage + mechanical consistency/perf)

  The additive/mechanical slice of the audit's low-severity long-tail; subjective
  nitpicks and anything behavior-risky were deferred (tracked in `TECH_DEBT.md`).
  Behavior-preserving except the small fixes noted, each covered by a test.

  - **Coverage:** focused unit tests for previously-untested pure logic —
    command-palette parsers, chat suggestions, prompt reducer + escape-sequence
    matcher, slash-command matcher, config appliers, provider-admin `configure`,
    url-safety scheme table, vault placeholder resolution, and more.
  - **Mechanical consistency/perf:** resolve vault object properties concurrently
    (key-order preserved), hoist per-row `stdout.columns`/`descWidth` reads out of
    the TUI tool list, drop a no-op identity `useMemo`, and a few small bounded
    fixes. A desktop latest-block cache-key bug (64-char-prefix collision) was
    fixed while adding its test.

- Updated dependencies [ff73468]
  - @moxxy/cli@0.12.7

## 0.8.7

### Patch Changes

- 091ef41: Quality sweep, wave 4 (Tier-3 safe subset — coverage + mechanical cleanup)

  Largely additive and behavior-preserving (every behavioral change is tested):

  - **Test coverage** for previously under-tested critical subsystems: core surface
    host multiplexer, runner surface RPC + `surface.data` broadcast, desktop-host
    git porcelain/diff + provider-discovery + prefs + onboarding + surface relay,
    config loader, skill-draft fence extraction, and more.
  - **Real bugs found while adding coverage:** desktop-host git `-z` rename parsing
    emitted a phantom `ChangedFile`; untracked-file diff used a hardcoded POSIX
    `/dev/null` (now `os.devNull`); `fetchProviderModels` could hang (now a 15s
    `AbortSignal.timeout`).
  - **Mechanical cleanup:** removed proven-dead exports/params, tightened weak
    types (dropped `as never` / unchecked double-casts, exhaustive switches),
    consolidated duplicated `<NAME>_API_KEY` slug + config up-walk helpers.

  Risky/voluminous Tier-3 (god-file decomposition, the long-tail review/test-gap/
  consistency/perf clusters) remains tracked in `TECH_DEBT.md` as the standing
  journal.

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/cli@0.12.6
  - @moxxy/chat-model@0.1.4
  - @moxxy/client-core@0.6.4
  - @moxxy/desktop-host@0.5.4
  - @moxxy/desktop-ipc-contract@0.7.4
  - @moxxy/ipc-server-ws@0.1.13
  - @moxxy/plugin-channel-mobile@0.1.14
  - @moxxy/plugin-stt-whisper-codex@0.0.19
  - @moxxy/plugin-vault@0.0.19
  - @moxxy/runner@0.2.6
  - @moxxy/workflows-builder@0.1.7
  - @moxxy/client-platform-web@0.1.13

## 0.8.6

### Patch Changes

- 640d036: perf(chat-model): incrementalize the per-turn block fold (kill the O(n²)/turn re-fold)

  Both the desktop Transcript and the TUI ChatView re-folded the ENTIRE growing
  event array via `pairToolEvents` on every committed event — k full O(n) walks
  per turn, degrading to O(n²) over a session. The fold body is now lifted into a
  reusable `stepFold(state, event)` (the verbatim old loop body) shared by the
  batch `pairToolEvents` and a new `IncrementalFold` that keeps the folded block
  tree alive across renders and re-folds only the unsettled tail past a
  `(version, prefixLength)` high-water mark. `syncTo` extends the prefix on a pure
  append and rebuilds only when it shifts (scroll-up prepend, /clear). A golden
  test feeds many recorded sequences (skill scopes, live tools, subagents, orphan
  results, reasoning, file diffs) one event at a time and asserts the incremental
  tree is byte-identical to `pairToolEvents(fullPrefix)` after EVERY event, plus a
  counter assertion that a k-event turn does O(k) — not O(k²) — step work.

  Also: the TUI settled-prefix scan resumes from its high-water mark instead of
  re-walking from index 0; `WorkflowCanvas` memoizes `topoOrder` on a geometry-free
  topology signature so a node drag no longer recomputes the O(V+E) fold per
  mousemove; and `usage.perCall` is head-capped at 200 entries (lossless for the
  meter — totals still fold every call).

- 640d036: Performance pass (audit-driven, golden-tested for byte-identity)

  Algorithmic-complexity fixes; every algorithm-shape change is guarded by a test
  asserting the new path is byte-identical to the old, so behaviour is unchanged.

  - **Event log / projection (`@moxxy/sdk`, `@moxxy/core`, `@moxxy/runner`):**
    index `EventLog.ofType`/`byTurn` (O(n) filter → O(matches), property-tested
    equal to the old filter); `applyLazyTools` single-partition + index-backed
    loaded-tool scan; `projectMessages` binary-cursor compaction-range lookup;
    `computeElisionState` fused passes + no redundant sort; `surfaceInputParamsSchema`
    O(keys) size guard instead of `JSON.stringify` per frame.
  - **Chat-model block fold (`@moxxy/chat-model`, `@moxxy/client-core`, TUI,
    desktop):** the O(n²)/turn re-fold is now incremental — only the unsettled tail
    re-folds, keyed on a high-water mark — with a golden test feeding events one at
    a time and asserting deep-equality with a full re-fold after every event. Bounds
    the live in-memory log / `seenIds` / `usage.perCall`; memoizes the workflow
    canvas topology so a node drag no longer recomputes it per pointer-move.
  - **Quadratic / unbounded hotspots:** `UsagePanel` peak via reduce (was a
    `Math.max(...series)` spread that RangeError'd on long sessions), `grep` file
    size cap + binary skip, `StreamingPreview` incremental last-line (fixed an
    infinite loop on leading-newline content), terminal sentinel-regex compiled
    once + tail scan, webhooks parse-body-once, scheduler batched schedule
    reconcile, `runProcess` concat-once, and a one-time session-log `ensureReady`.

- Updated dependencies [640d036]
- Updated dependencies [640d036]
  - @moxxy/chat-model@0.1.3
  - @moxxy/client-core@0.6.3
  - @moxxy/sdk@0.14.1
  - @moxxy/cli@0.12.5
  - @moxxy/client-platform-web@0.1.12
  - @moxxy/desktop-host@0.5.3
  - @moxxy/desktop-ipc-contract@0.7.3
  - @moxxy/ipc-server-ws@0.1.12
  - @moxxy/plugin-channel-mobile@0.1.13
  - @moxxy/plugin-stt-whisper-codex@0.0.18
  - @moxxy/plugin-vault@0.0.18
  - @moxxy/runner@0.2.5
  - @moxxy/workflows-builder@0.1.6

## 0.8.5

### Patch Changes

- 1e1b1d3: Fix the desktop agentic surfaces being undrivable: you couldn't type into the
  terminal and the browser wouldn't navigate.

  - **Surfaces were destroyed out from under their viewer (core).** A surface is
    shared (the agent's tool + the viewer drive one PTY/page), but `SurfaceHost`
    tore the instance down on the first `close`. React StrictMode (dev) makes that
    routine: it mounts → unmounts → remounts, so the first mount's late-resolving
    `open` fires a `close` that destroyed the instance the remount had just
    attached to. Output kept flowing (from the snapshot) so it looked alive, but
    `surface.input`/`surface.resize` then hit a missing instance and were silently
    dropped — no typing, no navigation, no resize, no error. Fixed with viewer
    ref-counting: the instance is only torn down when the last viewer detaches.
  - **Terminal mounted at the wrong width (desktop).** The context rail animated
    its width open, so xterm's `fit()` measured a mid-slide sliver and the shell
    drew its prompt hard-wrapped narrow (which xterm won't reflow). The rail now
    snaps open so the pane is full-width at mount; the fit is rAF-debounced +
    width-guarded, and the terminal is focused on attach.

- Updated dependencies [1e1b1d3]
  - @moxxy/cli@0.12.4

## 0.8.4

### Patch Changes

- e1fb6a6: Quality sweep, wave 2 (audit-driven, all gates green)

  Continues the 2026-06-18 monorepo sweep (`.claude/audits/`). Behavior is
  unchanged except for the documented bug fixes; every fix ships with a test.

  - **Dedup/generics onto shared homes:** route home-path derivations through the
    SDK `moxxyHome`/`moxxyPath` (fixes a latent `MOXXY_HOME` mismatch), one shared
    `refreshAndStore` for OAuth, a shared external-store helper in client-core, and
    one-shot provider calls routed through the shared SDK collector.
  - **Confirmed logic/correctness fixes (~50):** workflows (yaml block-scalar
    comment corruption, loop-exit determinism, hard-failure wave break, nested
    awaitInput, resume re-emit, sibling-name run resolution, paused-run reporting),
    desktop/client (SkillsView edit-clobber, command-palette dispatch, StrictMode
    double-IPC, ask-respond failure recovery, onboarding unhandled rejection, mic
    stream leak), and assorted fixes across core/cli/channels/providers/isolators.

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/cli@0.12.3
  - @moxxy/chat-model@0.1.2
  - @moxxy/client-core@0.6.2
  - @moxxy/desktop-host@0.5.2
  - @moxxy/desktop-ipc-contract@0.7.2
  - @moxxy/ipc-server-ws@0.1.11
  - @moxxy/plugin-channel-mobile@0.1.12
  - @moxxy/plugin-stt-whisper-codex@0.0.17
  - @moxxy/plugin-vault@0.0.17
  - @moxxy/runner@0.2.4
  - @moxxy/workflows-builder@0.1.5
  - @moxxy/client-platform-web@0.1.11

## 0.8.3

### Patch Changes

- 89ad994: Repo-wide quality + performance sweep (audit-driven, all gates green)

  A monorepo audit (report in `.claude/audits/quality-sweep-2026-06-18.md`) drove
  three test-backed waves. Behavior is unchanged except for the bug fixes below.

  **SDK (new public helpers):** `assertNever`, `writeFileAtomicSync`,
  `compareSemver`/`parseSemverCore`, and `countNodes` are now exported from
  `@moxxy/sdk` as the single home for those patterns.

  **Dead code & consistency:** removed the orphaned CDP screencast plumbing in
  `plugin-browser` and ~16 other proven-unused exports/modules; replaced the only
  banned private-field-poke cast with a DI seam; deduped repeated helpers onto
  shared homes (SearchBox, diff helpers, token estimate, semver, countNodes).

  **Security / correctness fixes:** view-spec `isSafeViewUrl` whitespace XSS
  bypass (parser + renderer walls); capability-broker SSRF-via-redirect,
  symlink/TOCTOU, and unbounded-buffer hardening; permission deny-rules now fail
  closed on an invalid regex; OAuth refresh race + stale-token-field fixes;
  isolator SIGKILL escalation, cwd, and abort-signal wiring; bounded validation on
  remote-reachable IPC commands; refusal to overwrite a built-in provider; an
  unbounded `completedTurns` leak; and several resource/timer/listener leaks.

  **Generics & atomicity:** extracted `ActiveDefRegistry`/`DefMapRegistry` bases
  (8 copy-paste registries → thin subclasses) and `defineOpenAICompatProvider`
  (per-vendor copy-paste collapsed); closed invariant-#5 gaps by adding
  per-instance mutexes + atomic writes to the file-backed stores that lacked them.

  Larger/riskier items (the O(n²) chat-model fold rewrite, a generic JSON store,
  god-file splits, and the long-tail findings) are tracked in `TECH_DEBT.md` for
  focused follow-up PRs rather than bundled here.

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/cli@0.12.2
  - @moxxy/chat-model@0.1.1
  - @moxxy/client-core@0.6.1
  - @moxxy/desktop-host@0.5.1
  - @moxxy/desktop-ipc-contract@0.7.1
  - @moxxy/ipc-server-ws@0.1.10
  - @moxxy/plugin-channel-mobile@0.1.11
  - @moxxy/plugin-stt-whisper-codex@0.0.16
  - @moxxy/plugin-vault@0.0.16
  - @moxxy/runner@0.2.3
  - @moxxy/workflows-builder@0.1.4
  - @moxxy/client-platform-web@0.1.10

## 0.8.2

### Patch Changes

- 0b8ec6f: Desktop terminal surface: fix the prompt rendering one character per line (and
  being hard to type into). The earlier fix guarded xterm's `fit()` but left the
  context rail's width _animation_ in place, so `fit()` still measured a mid-slide
  sliver and pushed ~2 columns to the PTY as its first size — the shell drew its
  prompt hard-wrapped to that width, and since xterm only reflows its own
  soft-wraps (not shell-hard-wrapped output) it stayed stacked even after the pane
  was full width. Drop the rail's width transition so the pane is at its real width
  the instant it mounts (the first fit — and the PTY's first resize — is therefore
  correct), keep the rAF-debounced, width-guarded fit for later user resizes, and
  focus the terminal on attach. Verified in a headless-chromium harness: the
  prompt's draw width goes from ~10 cols (animated) to the full 53 (snap-open).

## 0.8.1

### Patch Changes

- a50685b: fix(desktop): correct self-update feed asset names + modernise the native build

  - **Self-update 404 on macOS and Windows.** `productName` ("MoxxyAI Workspaces") has a space, and with no explicit `artifactName` the mac/win artifacts inherited it. electron-builder wrote that space as a hyphen into `latest-mac.yml`/`latest.yml` while GitHub rewrote it to a dot in the uploaded asset, so electron-updater built a download URL that didn't exist (e.g. `…/desktop-v0.8.0/MoxxyAI-Workspaces-0.8.0-arm64-mac.zip`). Mac and Windows now use a space-free `artifactName` (`moxxy-desktop-*`), matching Linux, so the feed path, the on-disk file, and the GitHub asset name all agree and `app.updateShell` resolves. (Releases ≤ 0.8.0 keep the broken names; this only fixes forward.)
  - **node-gyp modernised.** Pinned `node-gyp` to `^11.5.0` via root `pnpm.overrides` (was 9.4.1, which `@electron/rebuild` drives to compile `node-pty`) and removed the CI Python 3.11 pin — node-gyp 11 is Python-3.12-native. The Windows leg stays on `windows-2022` because no released node-gyp detects Visual Studio 2026 yet.

- 22b2c3c: Fix three bugs in the desktop agentic surfaces (terminal / browser / resizable rail):

  - **Rail wasn't resizable.** The drag handle is absolutely positioned, but
    `.col-rail` had no `position`, so it anchored to a far ancestor and landed
    off-screen — the divider looked draggable but nothing grabbed it. Anchor the
    handle to the rail, keep it inside the clip box, and drop the width transition
    mid-drag so the rail tracks the pointer 1:1.
  - **Terminal was shredded and unusable.** xterm's `fit()` ran synchronously on
    mount while the rail was still sliding open (≈0 width), locking the terminal —
    and the PTY it resized — to ~1–2 columns, so every character wrapped. Fit only
    once the pane has real layout (deferred + `ResizeObserver`-driven, width-guarded),
    and focus the terminal once the surface is attached so typing works immediately.
  - **Browser was stuck on "Loading…".** The CDP `Page.startScreencast` push emits
    no frames for a blank/static/headless page and swallowed its own failure, so the
    pane spun forever. Stream the page by polling a JPEG `frame` (always yields a
    frame, works on any Playwright browser) and surface a real error/launch status
    instead of an indefinite spinner.

- de7c7d3: desktop: the Skills settings tab now matches the MCP and Vault tabs. Its empty state uses the shared compact icon + text `EmptyState` instead of a bespoke hero with an oversized animated logo and duplicate create buttons; the create/generate actions already live in the shared tab header.
- Updated dependencies [22b2c3c]
  - @moxxy/cli@0.12.1

## 0.8.0

### Minor Changes

- 33e9640: Agentic surfaces: repurpose the desktop context rail into a dropdown of shared,
  agent-drivable panes.

  - New swappable **Surface** block in the SDK (`defineSurface`, `SurfaceRegistry`,
    `SurfaceHost`) + runner protocol **v8** (`surface.*` methods + `surface.data`
    stream) so a runner-owned interactive resource (a PTY, a browser page) streams
    to a thin client and takes its input back — no reverse RPC.
  - **Terminal** (`@moxxy/plugin-terminal`): a shared shell the user and the agent
    drive together via a new `terminal` tool; rendered live with xterm.js. Ships a
    real PTY via node-pty (optional native dep, N-API) with a dependency-free
    piped-shell fallback.
  - **Browser**: a live, in-window view of the agent's Playwright page on
    `@moxxy/plugin-browser`, streamed over a CDP screencast (`Page.startScreencast`)
    — the user and agent share one page; clicks/keys/scroll/navigation are proxied
    to it.
  - **Files changed**: a git-aware file list with the diff on the right; clicking a
    file opens a dropdown to Add it to the agent or Open it (diff/content). New
    `workspace.readFile` + `git.{isRepo,status,diff}` desktop IPC.
  - The context button now opens a dropdown (Terminal / Files changed / Browser)
    instead of toggling; the rail is drag-resizable with a persisted width.

- 143264a: Desktop OAuth providers now sign in for real instead of showing a "run `moxxy login` in a terminal" hint.

  Settings → Providers (and the onboarding wizard) drive a shared `OAuthSignIn` flow that spawns `moxxy login <provider>`, opens the browser, and — for out-of-band providers like `claude-code` — collects the pasted `claude setup-token` or `code#state` in the UI (browser-authorize primary, token paste as a fallback). Loopback providers (openai-codex) keep their automatic browser+callback flow.

  Mechanics: `moxxy login --stdin-prompts` relays each interactive prompt to the host as a NUL-bracketed marker on stdout (new `encodeLoginPrompt` / `createLoginStreamScanner` in `@moxxy/sdk`) and reads answers as stdin lines, so a GUI host can drive the paste flow without a TTY. The desktop exposes this via new `provider.login.start` / `answer` / `cancel` IPC commands and `provider.login.prompt` / `output` / `done` events; the dead `onboarding.runProviderLogin` command was removed. `onboarding.providerAuthKind` now derives a provider's auth kind from the runner's registry (fixing `claude-code` being mis-detected as an API-key provider) instead of a hardcoded list.

- 951f374: Make the model's reasoning visible, and redesign sub-agents as a collapsible group.

  **Reasoning preview (per-provider, Codex-style between calls).** When enabled, the model's
  thinking now streams live (replacing the silent "thinking…" dots) and is kept as a dim,
  collapsible "Thinking" block interleaved with the tool calls it precedes — so you can see what
  the model is doing instead of waiting out a multi-second pause. Because reasoning is finalized
  once per provider round, summaries land naturally between tool batches.

  It's gated per provider/model via a new `ModelDescriptor.supportsReasoning` capability and turned
  on with `config.context.reasoning` (`true`, or `{ effort: 'low' | 'medium' | 'high' }`):

  - **Anthropic / Claude Code** — adaptive thinking with summarized display; the signed thinking
    block round-trips so interleaved-thinking tool-use continuations stay valid.
  - **OpenAI Codex** — surfaces the reasoning summary it already requests (previously discarded).
  - **OpenAI** — `reasoning_effort` for the gpt-5 family plus the `reasoning_content` summary that
    OpenAI-compatible reasoning backends stream.

  New SDK surface: a `reasoning` `ContentBlock`, `reasoning_delta`/`reasoning_signature`
  `ProviderEvent`s, `reasoning_chunk`/`reasoning_message` events, a `ProviderRequest.reasoning`
  knob, and `ModelDescriptor.supportsReasoning`. No runner protocol bump — reasoning events ride
  the existing event channel.

  **Grouped sub-agents view.** A `dispatch_agent` fan-out now renders as one collapsible group —
  a header (`N Explore agents finished`) over a tree of per-agent rows showing each agent's tool-use
  count, **token usage**, and status — instead of one block per child. Per-agent token totals and the
  agent kind are forwarded on the `subagent_*` events; both the desktop and TUI render the new tree.

### Patch Changes

- 7366a09: Add a cross-channel file-diff preview for the Write/Edit tools. Every surface
  now shows what changed when the agent writes a file — a classic diff of the
  changed slices (±2 context lines) with line numbers, `+`/`-` markers, and
  green/red line backgrounds, plus a "Added N lines, removed M lines" summary.

  - The tools return a structured, channel-agnostic payload (`ToolDisplayResult`
    = `{ forModel, display }`); the model still sees only a short summary line, so
    the diff never bloats the context window.
  - TUI: an inline highlight preview; `Ctrl+O` expands the changed files.
  - Desktop: a diff card; click to expand the full set of hunks.
  - Web / Telegram / mobile each render the same payload natively.

  New public SDK surface (`@moxxy/sdk` and the dependency-free `@moxxy/sdk/tool-display`
  subpath for browser/React-Native consumers): `FileDiffDisplay`, `DiffHunk`,
  `DiffLine`, `DiffRow`, `ToolDisplay`, `ToolDisplayResult`, and the helpers
  `isToolDisplayResult`, `isFileDiffDisplay`, `fileDiffSummary`, `fileDiffVerb`,
  `diffGutterNo`, `toDiffRows`.

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/cli@0.12.0
  - @moxxy/desktop-ipc-contract@0.7.0
  - @moxxy/desktop-host@0.5.0
  - @moxxy/chat-model@0.1.0
  - @moxxy/client-core@0.6.0
  - @moxxy/ipc-server-ws@0.1.9
  - @moxxy/plugin-channel-mobile@0.1.10
  - @moxxy/plugin-stt-whisper-codex@0.0.15
  - @moxxy/plugin-vault@0.0.15
  - @moxxy/runner@0.2.2
  - @moxxy/workflows-builder@0.1.3
  - @moxxy/client-platform-web@0.1.9

## 0.7.2

### Patch Changes

- Updated dependencies [9f86a7b]
  - @moxxy/cli@0.11.0

## 0.7.1

### Patch Changes

- c15a45a: "Requires full update" releases now install themselves. New `app.updateShell` IPC drives electron-updater against a generic feed pinned at the exact `desktop-v<version>` release assets (GitHub latest/atom discovery can't parse `desktop-v*` tags), streaming download progress over `app.update.progress` and quit-and-installing on completion; the banner/Settings CTA becomes "Update app" with the release page kept as a fallback once an automatic attempt fails. macOS builds add a `zip` target so Squirrel.Mac can apply them, and desktop releases are no longer marked "Latest" on GitHub (`make_latest: false`).
- cc698ca: Two desktop fixes. (1) Fresh OAuth sign-up no longer strands the window on the Account Portal profile page: the portal-recovery net now also watches in-page (SPA) navigations — the portal's post-transfer router push to `/user` never fired `did-navigate` — and puts a 30s watchdog on the automatic `#/sso-callback` leg so a dead transfer page recovers into the app (where the boot sweep completes the sign-up) instead of requiring a restart. (2) Installing a full app update now actually runs it: the bootstrap's bundle gate gained a floor-version check (`older-than-floor` reject + active-pointer cleanup), so a hot-update override staged by a PREVIOUS install can no longer outrank the freshly installed shell — previously a stale 0.6 override kept booting over a newly installed 0.7.0, which then re-demanded the full installer forever.
- Updated dependencies [c15a45a]
- Updated dependencies [cc698ca]
  - @moxxy/desktop-host@0.4.1
  - @moxxy/desktop-ipc-contract@0.6.1
  - @moxxy/client-core@0.5.1
  - @moxxy/ipc-server-ws@0.1.8
  - @moxxy/plugin-channel-mobile@0.1.9
  - @moxxy/client-platform-web@0.1.8
  - @moxxy/cli@0.10.0

## 0.7.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- 358a565: Sidebar polish: workspace rows now carry a single color-tinted folder icon (replacing the grid glyph), row actions ([+] new session, ⋯ menu) are hover-only and overlay the right edge of the name with a gradient fade instead of reserving width — so workspace and session names use the full row when idle — and the sidebar widened 232px → 272px for readable first-prompt titles. desktop-ui gains a `folder` icon.
- Updated dependencies [aacdf1d]
- Updated dependencies [358a565]
  - @moxxy/sdk@0.11.0
  - @moxxy/cli@0.10.0
  - @moxxy/desktop-ipc-contract@0.6.0
  - @moxxy/desktop-host@0.4.0
  - @moxxy/client-core@0.5.0
  - @moxxy/desktop-ui@0.1.0
  - @moxxy/plugin-stt-whisper-codex@0.0.14
  - @moxxy/chat-model@0.0.14
  - @moxxy/ipc-server-ws@0.1.7
  - @moxxy/plugin-channel-mobile@0.1.8
  - @moxxy/plugin-vault@0.0.14
  - @moxxy/runner@0.2.1
  - @moxxy/workflows-builder@0.1.2
  - @moxxy/client-platform-web@0.1.7

## 0.6.0

### Minor Changes

- 0e1fb70: Sidebar redesign: every workspace is now a collapsible folder with its sessions nested beneath it (collapse state persists per workspace), a new-session [+] sits on each workspace row, and sessions are auto-titled from their first prompt (display-only, derived from the runner's meta sidecar at list time — also served to mobile via sessions.list) while staying renameable inline. client-core's useDesks gains desk-scoped session ops (createSession/setActiveSession/renameSession/removeSession) so the tree can operate across all workspaces at once.

### Patch Changes

- Updated dependencies [0e1fb70]
  - @moxxy/desktop-host@0.3.0
  - @moxxy/client-core@0.4.0
  - @moxxy/client-platform-web@0.1.6

## 0.5.4

### Patch Changes

- d3c1e26: Fix desktop sign-in never creating accounts for new users ("External account not found"). The account-portal recovery net no longer kills the portal's `/sign-in` + `/sign-up` pages — the OAuth sso-callback leg that converts a new-user sign-in into a sign-up runs there — and the renderer now sweeps up any dangling transferable OAuth attempt on boot and completes the sign-up + sign-in itself (`OAuthTransferBridge`), with a `clerk-captcha` mount node so bot-protection challenges can render outside the prebuilt components.
- Updated dependencies [d3c1e26]
- Updated dependencies [1450973]
- Updated dependencies [fee0523]
- Updated dependencies [5ab6c78]
  - @moxxy/desktop-host@0.2.1
  - @moxxy/cli@0.9.0

## 0.5.3

### Patch Changes

- Updated dependencies [54526cc]
  - @moxxy/plugin-channel-mobile@0.1.7
  - @moxxy/cli@0.8.2

## 0.5.2

### Patch Changes

- e2cea1b: The chat transcript sticks to the bottom while the agent streams a reply. If you scroll up, autoscroll pauses and a floating ↓ button appears (with a dot when new content arrives below); clicking it — or scrolling back down yourself — jumps to the latest message and re-enables autoscroll.

## 0.5.1

### Patch Changes

- ef314cb: Sidebar redesign: the WORKSPACES tree is replaced by a Slack-style workspace switcher — a roomy card showing the current workspace (name wraps instead of truncating, with a session count) that opens a dropdown to switch, remove, or create workspaces — and the active workspace's sessions become a flat, full-width list under a "Sessions" header with a [+] button. Row actions (rename/delete) move behind a hover-only ⋯ menu instead of always-visible icons. The Workflows view also gains a "Generate with AI" button — like Skills/MCP/Providers, it opens the ask-moxxy prompt box and the agent builds the workflow in the background via the `workflow_create`/`workflow_validate` tools, refreshing the list on completion. The switcher is text-only (no monogram tiles), and the sidebar can be collapsed/expanded (button in the rail, expand affordance in the main-pane header, Cmd/Ctrl+B, persisted across restarts).

## 0.5.0

### Minor Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/desktop-host@0.2.0
  - @moxxy/desktop-ipc-contract@0.5.0
  - @moxxy/client-core@0.3.0
  - @moxxy/design-tokens@0.2.0
  - @moxxy/desktop-ui@0.0.3
  - @moxxy/ipc-server-ws@0.1.6
  - @moxxy/plugin-channel-mobile@0.1.6
  - @moxxy/client-platform-web@0.1.5
  - @moxxy/cli@0.8.2

## 0.4.3

### Patch Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.
- Updated dependencies [4c594d8]
  - @moxxy/runner@0.2.0
  - @moxxy/desktop-host@0.1.8
  - @moxxy/cli@0.8.2
  - @moxxy/ipc-server-ws@0.1.5
  - @moxxy/plugin-channel-mobile@0.1.5

## 0.4.2

### Patch Changes

- 35754ad: Fix packaged-app Google sign-in doing nothing (eternal button spinner): clerk-js's prebuilt sign-in buttons run the provider flow as a TOP-FRAME redirect, not a popup, and the navigation lockdown silently blocked it. `lockDownNavigation` gains an explicit `allowOriginPatterns` allow-list; the main window passes the OAuth hosts plus its own loopback serving origins so the frame can round-trip app → provider → Clerk FAPI → back, while everything else (and the focus window entirely) stays blanket-denied. Also adds `challenges.cloudflare.com` to CSP connect-src per Clerk's documented Turnstile requirements so the sign-up captcha can't dead-end.
- Updated dependencies [35754ad]
  - @moxxy/desktop-host@0.1.7

## 0.4.1

### Patch Changes

- ad989eb: Workflow builder UX: the canvas pans by dragging the background (grab cursor; node drag / connection drag / click-to-deselect unaffected), the header controls (Back / validity badge / Save) align to the name/description input row instead of floating centred, and schema validation errors read as plain English anchored to the step — `step "greet": prompt must not be empty` instead of `steps.0.prompt: String must contain at least 1 character(s)` — so the builder can pin them to the offending node card.
- Updated dependencies [ad989eb]
  - @moxxy/cli@0.8.1

## 0.4.0

### Minor Changes

- b5c0f79: Desktop shell: Chat, Workflows and Settings now share one unified 64px header with a Chat|Workflows switcher in the main pane (the sidebar MENU group is gone — only Settings remains there, and picking a workspace returns to chat). The settings tabs moved into the header (right-aligned; the redundant Refresh button is removed). The workflow builder canvas gains zoom (40–200%): a −/100%/+ control cluster plus pinch / ctrl+wheel zooming anchored at the cursor.

## 0.3.0

### Minor Changes

- be7d33a: Workflow builder: the skill and tool name fields are now dropdowns of what the session actually has registered (with an explicit "(not installed)" marker for saved names that no longer exist, an empty-state message when there are no skills/tools, and a free-text fallback while no session is attached). Also fixes the macOS Dock "exec" ghost: the runner and other run-as-node children are spawned via the app's LSUIElement Helper binary, so they no longer register a second Dock icon.

## 0.2.2

### Patch Changes

- cfff99f: Self-heal the terminal "Update needed to continue" (protocol-incompatible) connection screen: when the spawned runner CLI is older than the app, the screen now offers a primary "Update CLI & reconnect" button that updates the bundled CLI in place (via `app.updateCli`) and re-runs the supervisor connect so the now-newer runner attaches cleanly — no hand-running npm. It shows an in-progress state while updating, surfaces failures with the exact manual `npm install --prefix "<userData>/cli" @moxxy/cli@latest` fallback, and when the app is the older side (a CLI update can't help) shows reinstall-the-app guidance instead of an update button.

## 0.2.1

### Patch Changes

- 270a9a1: Fix the desktop release build: bump `FLOOR_RUNNER_PROTOCOL` to 5 to match `RUNNER_PROTOCOL_VERSION` (the workflow.resume bump in #151 raised the runner protocol to 5 but left the desktop floor at 4, so the release-time lockstep assertion in `build-app-bundle.mjs` failed and the desktop release was skipped). Adds a unit test asserting `FLOOR_RUNNER_PROTOCOL === RUNNER_PROTOCOL_VERSION` so a forgotten floor bump fails normal CI instead of only the release.

## 0.2.0

### Minor Changes

- 218359b: fix(desktop): serve the packaged renderer from `https://desktop.moxxy.ai:<port>` so Clerk **production** keys work.

  A Clerk production key (`pk_live_`) is domain-locked: its Frontend API rejects any `Origin` that isn't `moxxy.ai` or a subdomain. The packaged renderer was served from a loopback IP origin (`http://127.0.0.1:<port>`), which a `pk_live_` key can never accept, so packaged sign-in with a production key silently failed.

  The loopback server now serves over **HTTPS** at `https://desktop.moxxy.ai:<port>` (a `moxxy.ai` subdomain that resolves to `127.0.0.1` via DNS, so traffic stays on-box). HTTPS uses a **self-signed cert** minted on first run and cached under `userData` (no key in the repo/bundle); the main process **scope-trusts** it via a session-level `setCertificateVerifyProc` (the reliable mechanism for loopback HTTPS under Electron's network service — `app.on('certificate-error')` does not fire here and is kept only as a fallback), trusting the cert only for that host + a matching fingerprint (not a blanket `ignore-certificate-errors`). The Host allow-list, CSP, and `allowedRedirectOrigins` now include the `desktop.moxxy.ai` origin; the DNS-rebinding guard stays intact for every other host. Dev (Vite + `pk_test_`) and the file:// fallback are unchanged.

  **Owner setup required** (one-time): add a DNS A-record `desktop.moxxy.ai → 127.0.0.1`, and register the four origins `https://desktop.moxxy.ai:{51789,51790,51791,51792}` in the production Clerk instance's allowed origins. See `docs/desktop-clerk-loopback-subdomain.md`.

- 2796066: feat(workflows): human-in-the-loop awaitInput — resume RPC + operator reply UI (un-gate)

  A workflow step can set `awaitInput: true` to pause and ask the operator a
  question, then continue with their reply. #146 gated this at validate/save time
  because the resume path hadn't shipped. The resume path now ships, so the gate
  is removed.

  - **Un-gate:** `awaitInput: true` is accepted again on **prompt/skill steps**
    (rejected on tool/workflow/logic/loop steps and on a loop body); `draft.ts`
    teaches the mid-run pause flow again with a worked example.
  - **Resume RPC (additive, protocol v5):** new `RunnerMethod.WorkflowResume`
    (`workflow.resume`) — server handler → `session.workflows.resume(runId, reply)`;
    `WorkflowsView.resume` (SDK) + CLI impl over the existing `resumeWorkflowRun`;
    `RemoteSession` client method gated on server protocol `>= 5` with the actionable
    "update the CLI" error (mirrors the v4 builder gate). `MIN_COMPATIBLE` stays at 1.
  - **Desktop / mobile / TUI:** `workflows.resume` added to the desktop IPC contract
    (+ host handler), the MobileSessionHost bridge, and `REMOTE_ALLOWED_COMMANDS`
    (RESPOND-only — answering a question the workflow asked, like `ask.respond`).
    Operator reply UI: desktop paused-workflow card (new client-core
    `usePausedWorkflows` hook) and TUI inline reply in the `/workflows` panel.
  - **Correctness:** the `workflow_paused` event now carries the workflow name +
    step label + question; vars set before a pause survive the checkpoint round-trip;
    `runNow` keeps treating a `paused` result as non-terminal (and the resume side
    delivers the now-completed run to the inbox); the stale-checkpoint sweeper +
    `clearRetainedChildren()`-on-shutdown are kept.

- c050573: Workflow builder canvas: drag-to-connect step wiring. You can now draw the
  dependency DAG directly on the canvas instead of only typing into the
  inspector's NEEDS field — and those connections ARE the workflow's execution
  order (an A→B edge means A runs before B).

  - Each node card gets connection handles: a left INPUT and a right OUTPUT
    (plain `needs`). Condition nodes expose labeled `then`/`else` output handles;
    loop nodes expose an `exit` output handle plus a distinct lower-half "body"
    drop region (upper-half input = the loop's own `needs`).
  - A pointerdown on a HANDLE starts a connection drag (live temp line following
    the cursor); a pointerdown on the card BODY still moves the node. Dropping on
    another node's card dispatches the matching shared op (`connect-needs`,
    `set-branch`, `set-loop-body`, `set-loop-exit`); dropping on empty canvas or
    the source's own card cancels cleanly.
  - Existing edges are interactive: click the edge or its midpoint ✕ to remove the
    dependency (routes through `disconnect-needs` / the relevant set-\* op).
  - Self-connects and cycle-closing connections are refused (the latter with a
    brief inline rejection), so the canvas can't author an invalid DAG.
  - Each node shows its 1-based topological execution order so the flow reads
    source→target.

  workflows-builder: `connectNeeds` now also rejects edges that would create a
  cycle, and exports a pure `wouldCreateCycle(state, from, to)` guard for
  interaction layers to check a gesture before dispatching.

### Patch Changes

- 5ab8629: fix(runner): tolerate additive protocol skew + stop the desktop hot-update reconnect loop

  A desktop Tier-1 hot-update ships only the JS bundle, so it advances the bundled
  `@moxxy/runner` client past the separately-bundled CLI's runner. The strict
  `protocolVersion !==` handshake then rejected the (purely additive) skew and the
  supervisor respawned the SAME pinned CLI forever — an infinite "Reconnecting…".

  - **Tolerant negotiation (contract change):** new `MIN_COMPATIBLE_PROTOCOL_VERSION`
    (bumped only on a BREAKING protocol change). The server accepts any client
    `>= MIN_COMPATIBLE` and returns its own version; the client records the server
    version and gates the v4-only `workflow.validateDraft/save/getRun` builder methods
    on it, degrading with a clear "update the CLI" error instead of a raw
    method-not-found. Additive skew now attaches cleanly.
  - **Desktop lockstep:** the signed app-bundle manifest carries a `runnerProtocol`
    stamp; the bootstrap refuses to activate (reverts to floor) any JS bundle whose
    stamp exceeds the spawnable CLI's protocol.
  - **No infinite loop:** a persistent mismatch surfaces a terminal
    `protocol-incompatible` connection phase with an actionable message after one
    failed recovery, rather than retrying into the same dead end.

- Updated dependencies [218359b]
- Updated dependencies [5ab8629]
- Updated dependencies [2796066]
- Updated dependencies [c050573]
  - @moxxy/desktop-host@0.1.6
  - @moxxy/runner@0.1.0
  - @moxxy/desktop-ipc-contract@0.4.0
  - @moxxy/sdk@0.10.0
  - @moxxy/cli@0.8.0
  - @moxxy/plugin-channel-mobile@0.1.4
  - @moxxy/client-core@0.2.0
  - @moxxy/workflows-builder@0.1.1
  - @moxxy/ipc-server-ws@0.1.4
  - @moxxy/chat-model@0.0.13
  - @moxxy/plugin-stt-whisper-codex@0.0.13
  - @moxxy/plugin-vault@0.0.13
  - @moxxy/client-platform-web@0.1.4

## 0.1.0

### Minor Changes

- cdc2cc5: Desktop: new Settings → **Mobile** tab to enable a mobile gateway and pair a phone by scanning a QR — the mobile app then drives the desktop host exactly like the TUI does.

  - **Runtime bridge control.** The opt-in WebSocket bridge (`@moxxy/ipc-server-ws`) can now be started and stopped at runtime, not only at boot. A new `MobileGatewayManager` (`apps/desktop/electron/main/ws-bridge.ts`) owns the lifecycle: start (binds the LAN-advertised interface — `0.0.0.0` — so a phone on the same Wi-Fi can reach it), stop (closes the listener + terminates clients), status (running/host/port/token/connectUrl/clientCount), and token rotation (re-keys the live server, dropping every existing client). The on/off preference is persisted to the desktop prefs file (`DesktopPrefs.mobileGatewayEnabled`) so the gateway survives a restart. The env-gated boot path (`MOXXY_WS_BRIDGE=1`) still works for back-compat.
  - **New IPC commands** (`@moxxy/desktop-ipc-contract`, all Zod-validated): `mobileGateway.status`, `mobileGateway.setEnabled(enabled)`, `mobileGateway.rotateToken`, plus a `mobileGateway.changed` event for live status updates. These control the bridge, so they are **host-only** — added to `REMOTE_DISALLOWED_COMMANDS`, the WS bus refuses them so a remote client can never toggle the gateway or read/rotate the pairing token.
  - **The QR payload IS the connect URL** (`ws://host:port/?t=<token>`), built with the mobile-channel's pure pairing helpers (split into `@moxxy/plugin-channel-mobile/pairing` so the desktop main can import them without the tunnel-provider deps). A test imports the shipped app's own `parsePairingQrPayload` and asserts the desktop's `connectUrl` round-trips through it — proving the QR the desktop emits is exactly what the app accepts.
  - **Security:** the gateway is OFF by default and only starts on explicit user action; the LAN bind is the user's opt-in, surfaced with a prominent honest warning in the tab; bearer-token auth via the `Sec-WebSocket-Protocol` subprotocol and Origin default-deny stay in force; token rotation invalidates existing connections.

- a1e5df1: Workflows visual builder GUI (phase 2 of 2): a drag-canvas on desktop + an outline editor on mobile, both built on one shared, DOM-free model.

  **New shared model — `@moxxy/workflows-builder`.** A genuinely DOM-free, RN-safe package (zero React, zero DOM, zero node built-ins — proven by the Expo iOS export) that both apps import. It holds: the canvas `BuilderState` + a typed `builderReducer`; pure operations (`addStep`/`removeStep`, `connectNeeds`/`disconnectNeeds`, `setBranchTargets`/`setSwitchCase`, `setLoopBody`/`setLoopExit`/`setLoopConfig`, `moveNode`/`setViewport`/`renameNode`/`updateNode`/`updateMeta`); a `serialize`↔`hydrate` pair that builds a `Workflow` object + `ui.layout` from the canvas and re-derives the node graph (incl. an auto-layout when `ui.layout` is absent); a dependency-free YAML codec scoped to the workflow shape (chosen over the `yaml` package, which reaches for `node:process`, so the RN bundle stays clean — authoritative validation is server-side); and the validate/save bridges that map `workflows.validateDraft` issues back onto the offending nodes. 32 unit tests cover operations, the serialize↔hydrate round-trip (loop body + exit + branches + layout), validation-error mapping, and the loop node's body/exit modeling.

  **The loop node's two-region visual model.** A `loop` node exposes (1) a BODY region — the steps that run inside the loop each iteration, toggled in the inspector and rendered as dashed "body" edges — and (2) a single EXIT edge to the next step, taken when the condition is met OR a body step errors, labeled "on done / error → next". The exit is modeled as the body-excluded step that `needs` the loop, so there's always exactly one exit edge and the on-disk schema is unchanged.

  **Desktop canvas (`apps/desktop/src/workflows/`).** `WorkflowsPanel` becomes a list↔builder switcher (keeping enable/disable + run-now + last-run, adding per-row Edit + New). The builder is a hand-rolled SVG drag-canvas (no react-flow — the graph is ≤40 nodes, so a graph lib's bundle cost wasn't justified): color-coded node cards per step kind, derived `needs`/branch/loop edges with labels, draggable nodes that persist x/y to `ui.layout`, a node inspector (edits each kind's action fields incl. the loop's body/exit/condition/maxIterations), an add-node palette, live validation that decorates the offending node, and Save (`validateDraft`→`save`). 7 testing-library tests.

  **Mobile editor (`apps/mobile/`).** New `app/workflow-edit.tsx` screen + `WorkflowEditor` component + `useWorkflowEditor` hook, consuming the same shared model over the mobile frame bridge (new `buildWorkflowValidateFrame`/`buildWorkflowSaveFrame`/`buildWorkflowDetailFrame`, wired to the `MobileSessionHost` handlers the engine added). v1 is an OUTLINE editor (a node list with the same operations, incl. the loop's body/exit/condition), not a touch-drag canvas — a graphical touch canvas was disproportionate for v1.

  **Shared IPC glue.** `client-core` gains `useWorkflowBuilder` (DOM-free) that drives `workflows.getRun`/`validateDraft`/`save` over the injected transport — the Electron preload bridge on desktop, the WebSocket bridge on mobile — so the validate/save flow is identical across platforms.

### Patch Changes

- 00d7425: Desktop mobile gateway: deny-by-default remote command allow-list + gateway hardening.

  **Security fix (critical/high).** The runtime mobile gateway (Settings → Mobile, PR #141) wired the desktop's COMPLETE IPC handler set onto the WebSocket bus and bound the LAN wildcard. The only per-command filter for remote clients was a blocklist that omitted host-mutating commands — so a paired phone (or anyone on the LAN with the bearer token) could invoke `session.setAutoApprove` (disable the desktop's approval prompts, then run any tool unattended), `desks.create`/`rename`/`remove`, `onboarding.saveProviderKey`/`openExternal`, `app.updateCli`/`checkUpdate`/`updateDashboard`, vault/settings/prefs writes, and more — a privilege-escalation / RCE-adjacent hole.

  The model is now **allow-by-default-deny**. `@moxxy/desktop-ipc-contract` exports `REMOTE_ALLOWED_COMMANDS` — the single source of truth for the remote/mobile trust surface (the exact commands a paired chat client needs: session info/runTurn/abort/setMode/newSession/runCommand, transcribe, ask RESPOND, connection discovery/retry, the per-workspace transcript log, and `workflows.list`/`run`/`getRun`). `@moxxy/ipc-server-ws`'s `WebSocketCommandBus` rejects any command not on the list with a coded error, regardless of what handlers the host registered. The Electron (renderer) bus keeps full access — only the WS/remote bus is restricted. `REMOTE_DISALLOWED_COMMANDS` is kept (deprecated) for renderer affordance-gating but no longer drives enforcement.

  **Finding 2 (medium).** Workflow AUTHORING is host-only: `workflows.save`, `workflows.validateDraft`, and `workflows.setEnabled` are NOT on the remote allow-list — a paired phone cannot rewrite or re-enable the host's workflows. Read + run (`list`/`getRun`/`run`) stay allowed.

  **Finding 3 (medium, stability).** `MobileGatewayManager` start/stop/setEnabled/rotate/resume now serialize through a lifecycle lock, so a rapid off→on toggle (or a boot resume racing a user toggle) can't double-bind the port or leak a LAN-bound listener.

  **Finding 4 (medium).** Token rotation is now coherent with a pinned `MOXXY_WS_TOKEN`: rotation is a no-op-with-warning when the env token pins the credential (it can't be rotated from here without diverging the advertised connectUrl from the live accepted token), and `status()`/`connectUrl` always reflect the live accepted token.

  **Finding 5 (medium, security UX).** The Mobile tab warning now states plainly that the connection is unencrypted plain `ws://`, so anyone on the network can passively intercept the pairing token and all traffic without the QR — use only on trusted networks.

  The standalone `moxxy mobile` host (`@moxxy/plugin-channel-mobile`) is its own trust surface (it registers a curated single-session subset) and opts out of the contract allow-list via `new WebSocketCommandBus({ allowedCommands: null })`. The wave-5 hardening (Origin default-deny, bearer subprotocol auth, connection caps, slow-reader eviction) is unchanged and still applies on the runtime-gateway path.

- 01a509b: Replace the logo on the desktop cold-start splash and loading screen with a plain ring spinner. The brand mark read poorly blown up on those large, empty surfaces; a neutral brand-pink ring is cleaner. The load-bearing `#splash-fallback` element (the self-update boot-probe health signal) is unchanged — only the visual inside it.
- Updated dependencies [1e4ed09]
- Updated dependencies [00d7425]
- Updated dependencies [cdc2cc5]
- Updated dependencies [e606178]
- Updated dependencies [a1e5df1]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/plugin-vault@0.0.12
  - @moxxy/desktop-host@0.1.5
  - @moxxy/desktop-ipc-contract@0.3.0
  - @moxxy/ipc-server-ws@0.1.3
  - @moxxy/plugin-channel-mobile@0.1.3
  - @moxxy/workflows-builder@0.1.0
  - @moxxy/client-core@0.1.3
  - @moxxy/runner@0.0.12
  - @moxxy/cli@0.7.3
  - @moxxy/chat-model@0.0.12
  - @moxxy/plugin-stt-whisper-codex@0.0.12
  - @moxxy/client-platform-web@0.1.3

## 0.0.35

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/cli@0.7.2
  - @moxxy/desktop-host@0.1.4
  - @moxxy/chat-model@0.0.11
  - @moxxy/client-core@0.1.2
  - @moxxy/desktop-ipc-contract@0.2.2
  - @moxxy/ipc-server-ws@0.1.2
  - @moxxy/plugin-stt-whisper-codex@0.0.11
  - @moxxy/plugin-vault@0.0.11
  - @moxxy/runner@0.0.11
  - @moxxy/client-platform-web@0.1.2

## 0.0.34

### Patch Changes

- 95222e1: Fix packaged-app boot crash: bundle `@moxxy/ipc-server-ws` into the main-process output and load it lazily.

  PR #120 added a top-level static import of `@moxxy/ipc-server-ws` to the Electron main but never added the package to `BUNDLED_WORKSPACE_DEPS`, so `externalizeDepsPlugin` left a bare specifier in `dist-electron/main/index.js` that cannot resolve in the packaged app (electron-builder ships only `dist`/`dist-electron`, no node_modules). Every packaged 0.0.33 build — and the Tier-1 hot-update bundle built from the same tree — crashed at main-process load with MODULE_NOT_FOUND, which would also have re-poisoned self-update overrides.

  Two-layer fix: `@moxxy/ipc-server-ws` is now in `BUNDLED_WORKSPACE_DEPS` (with `ws`'s optional native accelerators `bufferutil`/`utf-8-validate` kept external — `ws` falls back to JS implementations), and the bridge is loaded via a guarded dynamic `import()` only when `MOXXY_WS_BRIDGE=1` (the shell-updater pattern), so the opt-in bridge can never take down boot again. Verified on a real packaged build: boots clean, and with `MOXXY_WS_BRIDGE=1` the bridge listens.

- 0326fb0: Harden the desktop/mobile WebSocket bridge (2026-06-09 audit, wave 5):

  - Reject browser-Origin upgrades unless allow-listed (`allowedOrigins`, default deny; native clients are unaffected).
  - Move the pairing token out of the URL: `Authorization: Bearer` or a `Sec-WebSocket-Protocol` bearer entry are the supported presentations; the legacy `?t=` query is opt-in (`allowQueryToken`, kept on only for the mobile channel's already-paired apps). The QR still carries the token, but the app strips it before connecting.
  - Token rotation end to end: `rotateChannelToken` (sdk, persisted with `createdAt` + 90-day staleness warning), `rotateAuthToken` on the live server (drops existing connections), `rotateWsBridgeToken` (desktop) and `MobileChannel.rotateToken`.
  - Backpressure + lifecycle: connection cap (default 8), slow-reader eviction (backlog above 4 MB past a 10s grace terminates the socket), and `close()` now terminates clients so desktop quit doesn't burn its shutdown timeout.
  - `WsRpcClient` no longer replays abandoned requests after reconnect (outbox cleared, queued requests rejected on disconnect) and stops reconnecting after a capped exponential backoff, surfacing a terminal `disconnected` status.
  - Hygiene: empty `MOXXY_WS_PORT` no longer binds an ephemeral port, the server reports the actually-bound port, and the desktop bridge reuses the shared sdk token persistence (userData location kept).

- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
- Updated dependencies [05d643a]
- Updated dependencies [2e4bc37]
- Updated dependencies [05d643a]
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [2e4bc37]
- Updated dependencies [f297da0]
- Updated dependencies [0326fb0]
  - @moxxy/cli@0.7.1
  - @moxxy/sdk@0.8.0
  - @moxxy/desktop-host@0.1.3
  - @moxxy/plugin-vault@0.0.10
  - @moxxy/runner@0.0.10
  - @moxxy/ipc-server-ws@0.1.1
  - @moxxy/chat-model@0.0.10
  - @moxxy/client-core@0.1.1
  - @moxxy/desktop-ipc-contract@0.2.1
  - @moxxy/plugin-stt-whisper-codex@0.0.10
  - @moxxy/client-platform-web@0.1.1

## 0.0.33

### Patch Changes

- 5fcaaa7: Fix desktop self-update failing to load every override ("Cannot use import
  statement outside a module").

  The hot-update bundle ships only `dist/**` + `dist-electron/**`, so a staged
  bundle under `<userData>/app/<version>/` had **no `package.json` above its
  main**. The real main (`dist-electron/main/index.js`) is emitted as an ES module
  (`import` syntax), and Electron's bundled Node (v20, no ESM syntax
  auto-detection) decides ESM-vs-CJS from the nearest `package.json#type` — with
  none reachable it defaults to CommonJS and the bootstrap's `import()` threw
  `Cannot use import statement outside a module`. Every staged version
  (0.0.28/29/31/32) loaded this way got poisoned and the app silently reverted to
  the baked floor. The floor itself loads fine only because the packaged `.app`
  carries the desktop `package.json` (`"type":"module"`).

  `buildAppBundle` now ships a minimal `{"type":"module"}` `package.json` at the
  bundle root (signed into the bundle), and the stager writes the same marker at
  extract time when a bundle lacks one — so already-published bundles are also
  rescued on re-stage. The single marker is sourced from one constant shared by
  the producer and the stager so they can't drift.

- 85f9b91: Share the desktop client layer across platforms and expose the IPC over a WebSocket.

  The desktop renderer's hooks, state stores, chat model, and IPC client are now
  transport- and platform-agnostic so a future mobile app can reuse them:

  - **`@moxxy/client-core`** — the `use*` hooks + chat/connection/ask stores + chat
    model + the transport singleton + a platform-capability registry. DOM-free; the
    desktop renderer consumes it via thin `@/lib/*` shims (no behavior change).
  - **`@moxxy/client-platform-web`** — the Web implementations of those capabilities
    (mic capture/PCM16, Web Speech TTS, localStorage, window event bus).
  - **`@moxxy/design-tokens`** — framework-neutral tokens + a `:root` CSS generator.
  - **`@moxxy/client-transport-ws`** — a `MoxxyApi` over the global `WebSocket`
    (no Node deps), for remote clients.
  - **`@moxxy/ipc-server-ws`** — serves the same `IpcCommands`/`IpcEvents` contract
    over an authenticated WebSocket (loopback by default, bearer-token gated). The
    desktop's IPC handler registration is now transport-neutral (a `CommandBus`/
    `EventSink` seam + a shared `dispatch` core in `@moxxy/desktop-ipc-contract`), so the
    same handler bodies serve Electron IPC and the WebSocket; events fan out to both.
  - **`@moxxy/plugin-channel-mobile`** — a `mobile` channel that serves the bridge from
    the CLI backed by the runner's single session: `moxxy mobile` (and `moxxy serve --all`)
    expose it with no desktop needed. It can reach beyond the LAN via a cloudflared/ngrok
    tunnel (`channels.mobile.tunnel`) and prints a **QR code** (URL + token embedded) to
    pair. The desktop bridge stays opt-in via `MOXXY_WS_BRIDGE`.
  - **`@moxxy/sdk`** — adds `resolveChannelToken` + `bearerGuard`: the standard channel
    auth-token resolution (env → `channels.<name>.token` → a persisted secret) and a
    pre-connection bearer handler, so channels gate connections uniformly. The mobile
    bridge + WS server adopt them.

  A new `apps/mobile` Expo proof-of-concept drives the chat loop (and permission prompts)
  through the shared hooks over the WebSocket bridge — against either backend. First launch
  shows a QR scanner that pairs by scanning `moxxy mobile`'s code. Desktop behavior is
  unchanged.

- Updated dependencies [5fcaaa7]
- Updated dependencies [85f9b91]
  - @moxxy/desktop-host@0.1.2
  - @moxxy/sdk@0.7.0
  - @moxxy/desktop-ipc-contract@0.2.0
  - @moxxy/client-core@0.1.0
  - @moxxy/client-platform-web@0.1.0
  - @moxxy/ipc-server-ws@0.1.0
  - @moxxy/design-tokens@0.1.0
  - @moxxy/cli@0.7.0
  - @moxxy/runner@0.0.9
  - @moxxy/chat-model@0.0.9
  - @moxxy/plugin-stt-whisper-codex@0.0.9
  - @moxxy/plugin-vault@0.0.9

## 0.0.32

### Patch Changes

- c421ab5: Desktop: make Clerk sign-in work in the packaged app, and add a `moxxy://`
  deep-link.

  Sign-in failed in the packaged build with `prohibited_redirect_url`: the
  renderer was served from `file://`, so clerk-js derived a `file://` OAuth
  redirect, which Clerk rejects (only `http(s)` schemes are allowed). It worked
  in dev only because Vite serves `http://localhost`.

  The packaged renderer is now served from a hardened in-process loopback HTTP
  server (`http://127.0.0.1:<port>`, 127.0.0.1-only, fixed port list, GET/HEAD
  only, path-traversal + Host-header guards, SPA fallback). A loopback origin is
  a Chromium _secure context_ and an allowed OAuth redirect scheme, so the
  existing `clerk.openSignIn()` modal + OAuth popup work as they do on the web.
  The CSP gate now matches the loopback origin (directives unchanged — clerk-js
  still loads from the instance's Frontend API host), the focus widget loads from
  the same origin, and OAuth popups get a clean desktop-Chrome user-agent (no
  Electron/app tokens) to avoid Google's embedded-webview block. If every
  loopback port is taken, it falls back to `file://` (the window still renders).

  Also adds a `moxxy://` custom-protocol deep-link as general-purpose transport
  (single-instance lock + protocol registration + `open-url`/`second-instance`
  capture → a typed `deepLink:received` IPC event, with cold-start links buffered
  and drained via `deepLink:drain` on mount). Nothing routes on it yet — it's the
  plumbing for notification + action links.

  Owner action: add the loopback origins (`http://127.0.0.1` and
  `http://localhost` on the configured ports) to the Clerk dashboard's allowed
  origins / redirect URLs for the production instance.

- Updated dependencies [c421ab5]
  - @moxxy/desktop-ipc-contract@0.1.1
  - @moxxy/desktop-host@0.1.1

## 0.0.31

### Patch Changes

- 4c997f6: Fix desktop self-update never sticking ("downloads but stays on the old version").

  The boot-probe required the renderer's `app.appBooted` IPC heartbeat to land within
  15s to mark a hot-updated bundle healthy; in packaged builds that heartbeat doesn't
  reliably land, so the probe poisoned **every** healthy update and reverted to the
  floor (confirmed from on-disk state: `bad.json` had poisoned every staged version and
  `confirmed.json` never existed). The probe now confirms a healthy render from the
  **main process** by inspecting the renderer DOM — `index.html` ships a static
  `#splash-fallback` inside `#root` that React replaces on mount, so its absence is a
  renderer-cooperation-free health signal. The IPC heartbeat is kept only as a fast
  path; a genuine white-screen (never renders) is still poisoned and reverted.

## 0.0.30

### Patch Changes

- fab0fb4: Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

  - **CLI** — new `moxxy update` command: checks the npm registry, detects how the
    CLI was installed (npm/pnpm/yarn/bun, global or local), and runs the matching
    upgrade after a confirm. `--check`/`--dry-run` report-only, `--yes` to skip the
    prompt. Source checkouts get git advice instead of an install.
  - **TUI** — surfaces a newer published `@moxxy/cli` as a one-line, auto-dismissing
    banner and shows the running version in the status line. The check is cached
    (~12h) and fully non-blocking on startup. (Also fixes the `version` prop being
    dropped before it reached the view.)
  - **Desktop self-update** — the previously-silent fall-back-to-the-floor is now
    observable: a persistent boot-decision log under `<userData>/app/boot-log.json`,
    a reason for every gate that rejects a staged bundle, and a Settings → Dashboard
    → Diagnostics readout. The renderer's boot confirmation is hardened (retry +
    reported failure) so a flaky heartbeat can't make the boot-probe revert a
    healthy update. Adds the `app.updateDiagnostics` / `app.bootHeartbeatFailed` IPC.

- Updated dependencies [fab0fb4]
  - @moxxy/cli@0.6.0
  - @moxxy/desktop-ipc-contract@0.1.0
  - @moxxy/desktop-host@0.1.0

## 0.0.29

### Patch Changes

- e9ef74d: Desktop: fix sign-in doing nothing with a production (`pk_live_`) Clerk key.

  The packaged app's CSP and OAuth-popup allow-list only permitted Clerk's
  dev/test hosts (`*.clerk.accounts.dev` / `*.clerk.com`). A production
  publishable key serves clerk-js from the instance's OWN Frontend API domain
  (encoded in the key, e.g. `clerk.<your-domain>`), so the script was
  CSP-blocked, clerk-js never initialised, and `clerk.openSignIn()` silently
  rendered no modal.

  The Frontend API host is now decoded from the publishable key and folded into
  the CSP (`script-src`/`connect-src`/`frame-src`/`img-src`) plus the OAuth popup
  allow-list. The key is baked into the main bundle via electron-vite `define`
  (the renderer already read it via `import.meta.env`). Test keys are unaffected.

- Updated dependencies [e9ef74d]
  - @moxxy/desktop-host@0.0.10

## 0.0.28

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/chat-model@0.0.8
  - @moxxy/cli@0.5.5
  - @moxxy/desktop-host@0.0.9
  - @moxxy/desktop-ipc-contract@0.0.9
  - @moxxy/plugin-stt-whisper-codex@0.0.8
  - @moxxy/plugin-vault@0.0.8
  - @moxxy/runner@0.0.8

## 0.0.27

### Patch Changes

- cc62060: Stop the desktop chat-log from growing without bound on every restart. The runner
  replays a conversation's full event history to the renderer on each attach, and the
  renderer re-appended every replayed event to its NDJSON mirror
  (`~/.moxxy/chats/<workspace>.jsonl`), so the file grew by a complete copy of the
  conversation per restart — which also shifted `loadSegment`'s line-index cursors and
  corrupted scroll-up pagination. `appendEvents` is now idempotent by event id, so the
  log keeps exactly one copy and its pagination cursors stay stable.

## 0.0.26

### Patch Changes

- Updated dependencies [9a789fe]
  - @moxxy/cli@0.5.4

## 0.0.25

### Patch Changes

- a2d551f: Desktop: resume a workspace's conversation + model context across app
  restarts, and make `/new` actually start a fresh session.

  The desktop owns and kills its `moxxy serve` child on quit, and each launch
  spawned a bare `serve` that minted a brand-new empty session — so the model
  forgot the whole conversation and the transcript collapsed to just the
  post-restart message (the TUI didn't have this because its long-lived daemon
  survives a window close). Now each per-workspace runner is given a sticky
  session id (its desk id) so it resumes `~/.moxxy/sessions/<id>.jsonl` if present
  and starts fresh under that id on first run.

  - New `SetupOptions.sessionId` / `BuildSessionArgs.sessionId`: "resume-if-present"
    (distinct from `resumeSessionId`, which errors when the log is missing — for
    an explicit `moxxy resume <id>`).
  - `serve` reads `MOXXY_SESSION_ID`; the desktop `RunnerSupervisor`/`RunnerPool`
    pass the workspace's desk id through to it.
  - Renderer: the runner replays its FULL history on every attach (and re-attach
    after a reconnect), so the chat runtime now de-dupes ingested events by id
    (`seenIds`, kept in lockstep across live append, replay, and pagination). This
    makes a resumed replay idempotent and also fixes a latent bug where a transient
    reconnect to a still-alive runner could duplicate the transcript.
  - `/new` now works on its own (previously it did nothing in the desktop — only
    `/clear` was handled). It clears the transcript AND resets the runner via a
    new `session.newSession` IPC → `RunnerSupervisor.resetSession()`, which wipes
    the persisted session log and restarts so the model context truly resets and
    doesn't resurrect on the next launch.

- Updated dependencies [a2d551f]
  - @moxxy/cli@0.5.3
  - @moxxy/desktop-host@0.0.8
  - @moxxy/desktop-ipc-contract@0.0.8

## 0.0.24

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/cli@0.5.2
  - @moxxy/chat-model@0.0.7
  - @moxxy/desktop-host@0.0.7
  - @moxxy/desktop-ipc-contract@0.0.7
  - @moxxy/plugin-stt-whisper-codex@0.0.7
  - @moxxy/plugin-vault@0.0.7
  - @moxxy/runner@0.0.7

## 0.0.23

### Patch Changes

- Updated dependencies [fad9d6b]
  - @moxxy/cli@0.5.1

## 0.0.22

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
- Updated dependencies [2615cbf]
  - @moxxy/cli@0.5.0
  - @moxxy/sdk@0.5.0
  - @moxxy/chat-model@0.0.6
  - @moxxy/desktop-host@0.0.6
  - @moxxy/desktop-ipc-contract@0.0.6
  - @moxxy/plugin-stt-whisper-codex@0.0.6
  - @moxxy/plugin-vault@0.0.6
  - @moxxy/runner@0.0.6

## 0.0.21

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/cli@0.4.0
  - @moxxy/sdk@0.4.0
  - @moxxy/chat-model@0.0.5
  - @moxxy/desktop-host@0.0.5
  - @moxxy/desktop-ipc-contract@0.0.5
  - @moxxy/plugin-stt-whisper-codex@0.0.5
  - @moxxy/plugin-vault@0.0.5
  - @moxxy/runner@0.0.5

## 0.0.20

### Patch Changes

- f75a85f: Fix self-update never taking effect: the immutable bootstrap read
  `app.getPath('userData')` before `app.setName('MoxxyAI Workspaces')` ran (that
  call lives in the later-loaded `index.js`). In a packaged build Electron derives
  `getName()` from the package `name` (`@moxxy/desktop`), not electron-builder's
  `productName`, so the loader looked for staged updates under a different userData
  directory than the one the updater writes to — making every downloaded update
  invisible and silently booting the baked floor instead. The bootstrap now sets
  the app name before resolving `userData`, so it and the updater agree. (Takes
  effect after one fresh installer; subsequent hot-updates then apply.)

## 0.0.19

### Patch Changes

- a2087c0: Desktop: redesign sign-in, loading, focus mode, and onboarding; add one-click Node install.

  - **Sign-in** now opens Clerk's own modal from the sidebar profile pill — the
    dedicated onboarding "Sign in" step and the heavily-customized embedded
    `<SignIn>` are gone. The pill shows only **Sign in** or your profile (no more
    "Guest" state).
  - **Loading screen:** the connecting screen is now a friendly, branded surface
    on the app's near-white background (continuous with the splash and chat) — no
    more greyish "Starting moxxy serve…" with socket/pid rows. Failures show a
    short message + Retry with the diagnostics tucked behind a "Technical details"
    disclosure.
  - **Focus widget:** the mini-text panel is drag-resizable, renders the full
    latest message as scrollable Markdown, and stopping a voice recording now
    opens the panel to show the transcript + streaming answer.
  - **Onboarding:** refreshed two-column look (near-white pane, lighter step rail)
    plus a one-click **"Install automatically"** button that downloads the
    official Node LTS into the app's data dir — no admin or package manager — with
    the manual nodejs.org download as a fallback.
  - Swapped the moxxy loader/avatar animation.

## 0.0.18

### Patch Changes

- f7c236a: fix(desktop): a hot-update that failed to boot once could never be installed
  again. The bootstrap poisons a bundle version (adds it to `bad.json`) when its
  renderer doesn't confirm a healthy mount in time, but nothing ever cleared that
  mark — so every later "download + restart" re-staged the same version,
  `resolveActiveBundle` rejected it as poisoned, and the app silently fell back to
  the packaged floor ("downloads, but restart still shows the old version").
  `downloadAndStage` now clears the poison mark for the version it installs, since
  an explicit user (re)install is a deliberate retry; the boot-probe still
  re-poisons a genuinely broken bundle, so this only ever grants one fresh attempt.

## 0.0.17

### Patch Changes

- 0dad297: chore(ci): collapse the release pipeline into one changeset-driven workflow.
  The desktop installers now build + ship as gated jobs inside `release.yml`
  (folding in `release-desktop.yml`), removing the auto-PR machine and the
  cross-workflow dispatch. `@moxxy/cli` is now a declared desktop dependency, so a
  CLI/SDK release cascades a patch bump and cuts a desktop release automatically.
  A `Changeset present` CI job now fails any PR that lacks a changeset (use
  `pnpm changeset --empty` for no-release changes).

## 0.0.16

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/chat-model@0.0.4
  - @moxxy/desktop-host@0.0.4
  - @moxxy/desktop-ipc-contract@0.0.4
  - @moxxy/plugin-stt-whisper-codex@0.0.4
  - @moxxy/plugin-vault@0.0.4
  - @moxxy/runner@0.0.4

## 0.0.7

### Patch Changes

- Fix voice transcription returning "No speech detected": grant the renderer microphone access (macOS `NSMicrophoneUsageDescription` + audio-input entitlement + a media permission handler that triggers the system mic prompt), since macOS otherwise hands `getUserMedia` a silent stream. A captured-but-silent clip now reports an actionable microphone-access message instead.

## 0.0.6

### Minor Changes

- Self-update: the desktop now hot-updates its JS layers (renderer + main + preload + IPC contract) as one Ed25519-signed app bundle, activated by an immutable bootstrap loader — no reinstall. Rare native/Electron bumps fall back to electron-updater (Tier 2). Signature + SHA-256 + host-pin verified in the immutable floor; a boot-probe reverts a bundle that fails to render. See `docs/desktop-self-update.md`.

## 0.0.5

### Patch Changes

- 6dea644: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.0.4

### Patch Changes

- f3e3f1e: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/chat-model@0.0.3
  - @moxxy/desktop-host@0.0.3
  - @moxxy/desktop-ipc-contract@0.0.3
  - @moxxy/plugin-stt-whisper-codex@0.0.3
  - @moxxy/plugin-vault@0.0.3
  - @moxxy/runner@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/chat-model@0.0.2
  - @moxxy/desktop-host@0.0.2
  - @moxxy/desktop-ipc-contract@0.0.2
  - @moxxy/plugin-stt-whisper-codex@0.0.2
  - @moxxy/plugin-vault@0.0.2
  - @moxxy/runner@0.0.2
