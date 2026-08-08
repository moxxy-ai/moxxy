# Tech debt — living journal

This is the repo's standing tech-debt ledger. **Treat it as a journal:** read it
before non-trivial work, retire at least one item per change, and log new debt the
moment you see it. See AGENTS.md → "Tech debt is a standing job".

**Pruned 2026-06-24** — the historical saga write-ups and all resolved/"Retired"
entries were compacted away; what remains below is the currently-OPEN backlog as a
scannable summary. Git history holds the full prior journal if you need it.

**Cleanup pass 2026-07-05** — targeted backlog sweep (parallel fixes over disjoint
subsystems). Retired: `moxxy channels rotate-token` CLI, compile-time `RENDERER_DISPATCHED_METHODS`
partition, `moxxy mobile` session-source stamp, Vite orphan-ORT-wasm emit, `local`-provider
key prompt, a channel-catalog drift guard, and mobile grab-bag cleanups (SafeAreaView, dead
`ToolGroupUi` fields, unused `LargeHeader`); plus two VERIFIED-already-fixed (`provider.setEnabled`
race now serialized by `configMutex`; one-shot commands drain via `closeSession()`) with
regression tests added. Refined (narrowed, still open): `resolveModelContext` now warns on the
`models[0]` fallback (calibration-from-usage still open); dropped-attachment notice, `FilesPane`
repo-root, built-in-provider model editing, and the remaining mobile-misc items carry precise
implementation paths. Full pre-PR gate green.

Severity tags: `[critical]`/`[high]`/`[med]`/`[low]`, `[note]` = standing practice
or recorded-on-purpose decision.

## Open

- [med, context/intra-turn-overflow, LOGGED 2026-08-03] The `segments` compactor
  bounds context ACROSS turns; it cannot bound a single runaway turn. Compaction
  and elision both advance only on completed-turn boundaries, so one turn that
  makes hundreds of tool calls can still approach the window on its own. Under
  pressure `segments` drops the verbatim tail to one turn and the loop's
  reactive `force` compaction still fires, but neither touches the live turn.
  A real fix needs intra-turn compaction that preserves tool_use/tool_result
  pairing. `packages/compactor-segments/src/segments.ts`,
  `packages/sdk/src/elision-helpers.ts`.

- [low, context/chapter-fidelity, LOGGED 2026-08-03] Each chapter fold caps its
  output at half the records it replaces, so detail degrades geometrically the
  longer a session runs. That is the intended trade (a bounded index beats a
  faithful one that overflows), and `recall({ turnId })` still reaches the
  originals, but there is no signal to the model that an old chapter is
  lossier than a recent record. Consider stamping a fold depth on the header.
  `packages/compactor-segments/src/index.ts`.

- [low, desktop/hotkeys-menu, LOGGED 2026-08-03] The keymap is renderer-only, so
  the Electron application menu still lists just Focus Mode. Nothing surfaces
  the shortcuts outside the ⌘/ sheet and the composer hint, and shortcuts do not
  work when a non-renderer window holds focus. Wiring menu accelerators needs a
  main→renderer IPC command and a rule that a chord is bound in exactly one
  place (menu OR renderer) so it can't fire twice.
  `apps/desktop/electron/main/menus.ts`, `apps/desktop/src/hotkeys/`.

- [note, desktop/voice-hologram-two-modes, LOGGED 2026-08-08] The Voice Mode
  hologram deliberately renders in two different visual languages, not one
  parameterised look: on ink it is emissive (`lighter` compositing, canvas
  shadow bloom, a near-black field the canvas paints itself), on paper it is a
  drawn technical trace (`source-over`, no bloom, flares degraded to
  registration crosses) because additive light over white is a no-op. Anyone
  "unifying" the two branches will silently erase the mark in the light theme.
  The stage's `::after` fades exist only to hand the canvas's own deep field
  back to `--color-main-bg` at the header and transcript edges.
  `apps/desktop/src/voice-call/{useVoiceHologramAnimation.ts,voice-call.css}`.

- [low, desktop/focus/retired-mascot-assets, LOGGED 2026-08-08] Focus Mode now
  draws the Moxxy mark, so the `brick-girl` avatar subsystem has no consumer
  left: `useVoiceAvatarAnimation.ts`, `voice-avatar-animation.ts` and their two
  test files are unreachable, and the five owner-supplied PNGs under
  `voice-call/assets/brick-girl/` are no longer imported (so Vite no longer
  bundles them). Deliberately NOT deleted in the same change — the frames were
  supplied by the project owner and the checksum contract still pins them.
  Delete the code and the assets together once the owner confirms the mascot is
  not coming back. `apps/desktop/src/voice-call/`.

## Resolved ledger

- [med, desktop/chat/virtualization, RESOLVED 2026-08-08] The shared transcript
  passed unmatched tool-result fallback blocks to Virtuoso even though the
  desktop renderer intentionally produced no DOM for those bookkeeping events.
  Their measured height was therefore zero, producing repeated runtime errors
  after Voice Mode reused the full transcript. A pure render-node visibility
  filter now removes only non-rendering event fallbacks before grouping and
  virtualization; real user, assistant, reasoning, tool, extension, error, and
  abort rows remain chronological and measurable. A reducer-backed regression
  covers an orphan result between visible conversation events.
  `apps/desktop/src/chat/{Transcript,transcript-nodes}.ts`.

- [low, desktop/editable-target-dupe, RESOLVED 2026-08-08] Workflow canvas now
  imports the canonical editable-target predicate from the hotkey subsystem;
  the duplicate graph helper and its duplicate tests were removed, while the
  shared behavior remains pinned beside the hotkey registry tests.
  `apps/desktop/src/{hotkeys,workflows}/`.

- [med, desktop/sidebar-hierarchy, RESOLVED 2026-07-31] Workspace headers and
  idle session rows collapsed into nearly the same visual tier, while the
  borderless grouping experiment left indentation as the primary containment
  cue. The workspace tree now adopts the hierarchy proven in PR #498: square
  `Desk.color` chips distinguish folders from round session LEDs, muted header
  text stays distinct from dim rows, inter-group rhythm separates siblings,
  and a narrow guide rail makes each session list's ownership explicit. Tests
  pin all four cues and both theme palettes pin the tier contrast.
  `apps/desktop/src/shell/workspace-sidebar/WorkspaceTree.tsx`,
  `packages/design-tokens/src/contrast.test.ts`.

- [med, desktop/file-previews, RESOLVED 2026-07-31] The workspace file and
  diff surfaces rendered every source file as undifferentiated text, while PDF
  content was a bare iframe and common document/media formats fell through to
  binary confirmation. Filename-driven Prism grammars now load on demand and
  render token trees as React nodes (never HTML), with line numbers and strict
  source/diff size caps that preserve the plain-text fast path. Markdown gains
  a safe preview/source switch, Office and OpenDocument files expose extracted
  text, PDFs have app-native fit/download chrome, and local audio/video use
  non-autoplay Blob previews. Workspace/symlink confinement, bounded host reads,
  remote IPC denial, and the existing blob-only CSP remain intact.
  `apps/desktop/src/shell/surfaces/`,
  `packages/{desktop-host,desktop-ipc-contract}/src/`.

- [med, desktop/dialog-layout, RESOLVED 2026-07-31] The shared dialog primitive
  had no viewport height bound or internal scrolling region, while the model
  picker independently grew both lists to 360 px. On compact windows this
  pushed usage details and the primary action below the visible frame. Dialogs
  now share compact header and action-row chrome, stay inside the dynamic
  viewport, and scroll only their content. The provider/model grid owns a
  responsive bounded height with independently scrolling columns, so “Model &
  usage” keeps its context readout and compaction action reachable without
  allowing a long model catalog to resize the overlay.
  `packages/desktop-ui/src/Modal.tsx`,
  `apps/desktop/src/{chat/agent-picker,shell/instrument}/`.

- [med, desktop/onboarding, RESOLVED 2026-07-31] The final onboarding CTA
  waited for the preferences IPC round-trip before flipping renderer state.
  A durable `onboardingComplete: true` write could therefore succeed while the
  user remained on the last screen if the response was delayed or lost during
  startup. After that write, a provider-less runner opened the one-step recovery
  flow, whose "Skip for now" action incorrectly called the linear cursor even
  though auto-recovery ignores that cursor, producing a second dead end.
  Completion is now optimistic, and skipping optional provider recovery
  dismisses it for the active workspace until that workspace gains a provider.
  Regressions cover both an unresolved preferences IPC and the recovery skip.
  `apps/desktop/src/{App,app-readiness,onboarding}/`.

- [high, desktop/runner-isolation, RESOLVED 2026-07-31] The desktop runner pool,
  bare supervisor, and stale-socket sweep hard-coded `~/.moxxy` even though the
  runner and every other state helper honor `MOXXY_HOME`. An isolated packaged
  smoke test could therefore scan and terminate a live runner belonging to the
  user's normal profile. All three paths now share `moxxyPath` /
  `runnerSocketPath`; regressions pin relocated unbound, workspace, and sweep
  paths so one profile cannot inspect another profile's sockets.
  `packages/desktop-host/src/{runner-pool,runner-supervisor,sweep-sockets}.ts`.

- [high, desktop/voice/plugin-seed, RESOLVED 2026-07-31] Packaged plugin seeds
  persisted direct dependencies as `file:.../moxxy-seed-tars-*/package.tgz`,
  then deleted that build directory. Every later npm mutation of the shared
  plugin prefix therefore failed while resolving an unrelated missing tarball,
  which broke the one-click Local Piper install. New seeds rewrite only those
  generated specs to exact installed versions before packaging; existing user
  manifests are migrated atomically and serially from validated installed
  package metadata before Piper invokes the fixed host-owned CLI command.
  User-authored local dependencies remain untouched, dead generated entries are
  removed, and bounded CLI stderr now reaches the installer error instead of a
  generic network-only diagnosis. `apps/desktop/scripts/bundle-plugins-seed.mjs`,
  `packages/desktop-host/src/{seed-plugins,local-piper}.ts`.

- [low, tests/determinism, RESOLVED 2026-07-31] The Focus Mode streaming-preview
  regression now compares the native window dimensions after consecutive
  assistant chunks instead of counting `focus.resize` calls. Pending effects
  from an earlier test can no longer make the assertion order-dependent, while
  the user-visible invariant — a stable inactive preview window — remains
  covered. `apps/desktop/src/focus/FocusWidget.test.tsx`.

- [med, tests/determinism, RESOLVED 2026-07-28] The workflows
  `fileChanged`-across-two-runners test was still failing (1 in 6 idle, 2 in 3
  under load) after being declared fixed on 2026-07-27. The earlier fix treated
  it as a timing budget problem; it is not one. `fs.watch(dir, {recursive:true})`
  is FSEvents on macOS and is not delivering when the call returns, so the single
  write issued right after boot fell into that gap and was dropped outright. No
  waiting rescues a dropped event, which is why a bigger timeout changed nothing.
  The test now writes in a bounded retry loop and stops at the first observed
  run. Retrying cannot weaken the at-most-once assertion because duplicates
  collapse twice: the 600 ms debounce coalesces events per watch key, and the
  `wf-file:` fire lock (3 s TTL) coalesces fires per key across both runners.
  Verified 12/12 idle, 6/6 under a full `turbo run test --force`, and
  mutation-checked both ways: disabling the fire lock still fails with "got 2",
  and a watcher that never registers fails in 15 s with a named message rather
  than hanging. `packages/cli/src/setup/workflows.test.ts`.


- [med, tests/determinism, RESOLVED 2026-07-27] Three suites failed only under
  full-suite parallelism, which made a local `pnpm test` unable to distinguish a
  regression from load. Each was a test asserting wall-clock timing rather than
  behaviour. `CrossProcessFireLock` used a 15 ms TTL with a real `sleep`, so any
  scheduling pause between claiming the fresh marker and sweeping expired it
  too; it now sets file mtimes and passes the injectable clock, with no sleep at
  all. The workflows `fileChanged`-across-two-runners test raised its `vi.waitFor`
  budget to 20 s while vitest's default TEST timeout stayed 10 s, so the generous
  budget was dead code and the test died first; it now declares its own 40 s
  timeout. THAT DIAGNOSIS WAS INCOMPLETE and the test kept failing (see the
  2026-07-28 entry below). `isolator-subprocess`'s cooperative-abort test asserted that the
  production 150 ms grace was enough for a child to be scheduled AND flush, which
  is a measurement of machine load; `abortGraceMs` is now injectable and the test
  passes a generous value, asserting the mechanism while the production default
  is unchanged. A repo-wide scan found no other test whose internal wait budget
  exceeds its own timeout. `packages/sdk/src/cross-process-lock.test.ts`,
  `packages/cli/src/setup/workflows.test.ts`, `packages/isolator-subprocess/src/`.

- [med, tui/providers, RESOLVED 2026-07-23] Text-only models were still given
  the lazy skill index, so Claude Code imitated `load_skill(...)` as assistant
  text and ended the turn before doing the work. ReAct prompt composition now
  advertises skills only to tool-capable models, letting Claude CLI keep its
  native operation inside one busy turn. Tool/skill activity now tracks the
  actual load/result state (rather than an open grouping scope), mutable fold
  rows carry an explicit render revision, completed work loses its shimmer,
  zero-count metadata is omitted, and nested Ink rows use compact branch guides.
  `packages/sdk/src/mode/react-loop.ts`, `packages/chat-model/src/`,
  `packages/plugin-cli/src/components/chat/`, `apps/desktop/src/chat/`.
- [low, tui, RESOLVED 2026-07-23] Origin-bearing prompts now render in the TUI
  as compact webhook/schedule/workflow/checkpoint activity markers, with the
  full synthesized payload available through the existing Ctrl+O expansion,
  instead of looking like a human-authored user prompt.
  `packages/plugin-cli/src/components/chat/EventLine.tsx`.
- [med, scheduler, RESOLVED 2026-07-23] `schedule_create` rejected otherwise valid
  recurring and one-shot tool calls when a provider serialized omitted optional
  fields as blank strings. Its local trust-boundary schema now normalizes only
  blank optional placeholders before enforcing the exactly-one-trigger invariant,
  with captured-payload regressions through the real schedule store.
  `packages/plugin-scheduler/src/tools.ts`.
- [high, desktop/voice/focus-realtime, RESOLVED 2026-07-23] Focus Mode hid the
  main renderer that intentionally remained the sole owner of microphone,
  recorder, analyser, VAD, and transcription. Chromium's default background
  throttling then coalesced the owner's 40 ms VAD timer, so an immediate phrase
  after Desktop → Focus or mute → unmute could be ignored until a later repeat.
  The desktop host now grants a strict local-only realtime-capture lease for
  exactly the lifetime of an active main-renderer Voice Mode call and restores
  normal throttling on close, reload, or window teardown. A suspended
  `AudioContext` must reach `running` before tracks, recorder, analyser, and the
  UI return to listening; generation guards prevent a late resume from
  re-enabling a microphone the user muted again. Focus remains a remote control
  and spectrum mirror, never a second audio owner. Regressions cover the IPC
  boundary, host lease lifecycle, initial and repeated resume, resume failure,
  rapid mute/unmute/mute, ten reuse cycles, and the Focus preparation status.
  `apps/desktop/electron/main/`, `apps/desktop/src/{focus,voice-call}/`,
  `packages/{client-core,client-platform-web,desktop-host,desktop-ipc-contract}/src/`.
- [high, desktop/voice/utterance-endpointing, RESOLVED 2026-07-23] Voice Mode
  used the same high RMS threshold to both start and retain speech, then ended
  an utterance after only 900 ms below that threshold. Quiet syllables and
  ordinary thinking pauses could therefore dispatch a visibly truncated prompt
  even though the microphone and transcriber were healthy. Endpointing now uses
  hysteresis: strong evidence is still required to begin speech, while a lower
  noise-aware hold threshold preserves natural changes in volume. A turn closes
  only after 1.5 seconds of actual silence. Deterministic regressions cover quiet
  continuation, a resumed sentence after a natural pause, and a fresh detector
  lifecycle across mute/unmute without changing the STT endpoint or payload.
  `packages/client-core/src/voice-activity.ts`,
  `apps/desktop/src/voice-call/useVoiceActivityDetection.ts`.
- [high, desktop/voice/microphone-lifecycle, RESOLVED 2026-07-23] Voice Mode
  implemented mute by destroying its `MediaStream`, recorder, analyser, and
  audio context, then reported `listening` before the asynchronous replacement
  capture was ready. Immediate speech after unmute could therefore lose its
  opening, merge several sentences, or miss the utterance entirely. A second
  race let a pending `getUserMedia` resolve after mute because acquisition was
  still exposed as `idle`. Recorder acquisition is now tracked explicitly;
  mute disables every stream track, discards the partial utterance, and pauses
  without releasing the allocated microphone, while unmute starts a fresh
  recorder on that same stream. Pending acquisition honours mute before it can
  become active, stale failures remain generation-gated, and the call exposes
  `arming` until capture is genuinely ready. Regressions cover active and
  pending mute/unmute, single-stream reuse, muted-audio exclusion, stop/mute
  ordering, Focus bridge validation, and the preparation UI.
  `packages/client-core/src/{platform,useVoiceRecorder,useVoiceCall}.ts`,
  `packages/client-platform-web/src/audio-capture.ts`,
  `apps/desktop/src/voice-call/`.
- [med, desktop/focus/conversation, RESOLVED 2026-07-23] Focus Mode treated
  intermediate `tool_use` messages as completed replies, let the stale task
  status reappear after a final answer, and offered a text surface that omitted
  the user's matching prompt, attachments, multiline input, selection-safe
  scrolling, and queued turns. The reply selector now admits only committed
  `end_turn` output, scopes visibility to one turn, expires after 15 seconds,
  and supports explicit pin and dismiss actions. The mini transcript projects
  exactly the latest user/assistant pair with existing Markdown and image
  preview primitives, preserves text selection, exposes removable FIFO queue
  entries, and uses an auto-growing IME-safe textarea. Restore geometry now has
  dedicated inactive and active docks beside or above Moxxy instead of
  overlapping the persona or consuming another action-bar slot. Completed
  reply bubbles open the mini chat in both ordinary and Voice Mode states,
  keep their dismiss action in the expected top-right corner, and avoid the
  light-theme blur halo. Voice calls opened
  from Focus are owned by the main renderer through the existing validated,
  workspace-scoped bridge, so restoring the main window returns to the live
  call without duplicating microphone, STT, or Piper ownership. Regression
  coverage exercises final-reply timing, tool-use exclusion, attachments,
  queue order, multiline input, geometry, and StrictMode-safe voice transfer.
  `apps/desktop/src/{focus,voice-call}/`,
  `packages/desktop-ipc-contract/src/`.
- [low, desktop/focus/task-status, RESOLVED 2026-07-23] Focus Mode animated
  Moxxy while work was active but gave no compact indication of what the turn
  was doing, so users had to reopen the main chat to distinguish ongoing work
  from an idle pet. A pure selector now derives only the current user prompt or
  a safe high-level activity label, and a presentation-only bubble can be
  hidden and restored without touching the turn. Permission and input requests
  remain mandatory sidecars, native resizing is schema-validated and
  bottom-anchored, and integration tests cover visibility, restore behavior,
  decision precedence, and geometry in both directions.
  `apps/desktop/src/focus/`,
  `packages/{desktop-host,desktop-ipc-contract}/src/`.
- [low, desktop/focus/avatar-memory, RESOLVED 2026-07-23] Reusing the five
  1122×1402 Voice Mode frames in the always-on-top Focus renderer would have
  decoded roughly 30 MB of character pixels for an 84×104 surface. Focus now
  loads aligned 320×400 alpha-preserving derivatives through the same reusable
  animation hook, while asset-contract tests pin their dimensions and alpha.
  The full call screen keeps the untouched source frames. The pet state policy
  is pure and tested, and its component remains presentation-only.
  `apps/desktop/src/{focus,voice-call}/`.
- [low, desktop/voice/avatar-assets, RESOLVED 2026-07-23] The owner-supplied
  Voice Mode persona depended on five identically aligned transparent frames,
  but an accidental resize, recompression, or alpha-channel change would have
  silently produced visible mouth and blink jumps. A real asset-contract test
  now pins every original SHA-256 checksum, dimension, PNG type, and alpha
  channel. Frame selection and amplitude smoothing are pure and tested, while
  image loading and analyser-driven animation live in a reusable hook behind a
  presentation-only component. `apps/desktop/src/voice-call/`.
- [low, desktop/focus/voice-discovery, RESOLVED 2026-07-22] Focus Mode assumed
  that an available transcriber also meant full Voice Mode was available, so it
  rendered a start control before checking whether Local Piper existed and then
  expanded into an installer/error flow. Focus now probes the local package
  independently during hydration, keeps the control absent while availability
  is unknown, false, or failed, and sizes the compact bar from the controls that
  are actually visible. Installation remains on the full Voice Mode surface.
  A renderer integration regression locks down the real preflight IPC and the
  absence of both start and install controls. `apps/desktop/src/focus/`.
- [med, desktop/voice/onboarding, RESOLVED 2026-07-22] Voice Mode treated a
  missing Local Piper package exactly like an installed but inactive
  synthesizer, leaving a first-time user with configuration advice but no way
  to obtain the offline voice. The preflight now distinguishes a complete
  first-party package from an inactive contribution, and the full call surface
  exposes a one-click, single-flight installer. Focus instead stays hidden until
  that package is present. The host-only IPC
  accepts no input, pins the package and contribution names in the main
  process, validates the installed manifest and compiled entry, remains denied
  on the remote/mobile command surface, restarts every runner after success,
  and automatically retries the same call. That post-install retry now tolerates
  the bounded interval in which the replacement runner has not exposed its
  local transcriber or selected synthesizer yet. Real temporary-filesystem probes,
  deterministic CLI-adapter tests, IPC trust-boundary tests, hook integration,
  cross-window routing, and renderer tests cover the flow without changing STT,
  including a temporarily absent runner-side transcriber.
  `packages/{client-core,desktop-host,desktop-ipc-contract}/`,
  `apps/desktop/src/{voice-call,focus}/`.
- [high, desktop/voice/barge-in, RESOLVED 2026-07-22] Voice Mode released the
  microphone while Piper was speaking, so interrupting an overly long answer
  required manual controls and could not flow into the next turn. The desktop
  now keeps an echo-cancelled, noise-suppressed monitoring capture during Piper
  playback, compares microphone energy with the live output analyser, and uses
  the existing VAD speech-start event to stop playback and abort only the active
  turn. A bounded pre-roll keeps the opening phoneme while discarding audio
  captured before the interruption; late chunks and completion from the aborted
  turn are suppressed so they cannot speak over or complete the replacement
  prompt. The main renderer remains the sole microphone owner when Focus Mode is
  visible, and mute still disables monitoring. Deterministic integration tests
  cover echo rejection, genuine speech, atomic queue/turn interruption, stale
  event suppression, natural utterance completion, recorder-start races, and
  unchanged PCM16 transcription output. Packaged verification also exposed
  that the production CSP inherited `default-src 'self'` for media and blocked
  Piper's renderer-created Blob URLs even though dev playback worked. A narrow
  `media-src 'self' blob:` directive now permits only local synthesized media;
  script, connection, object, and remote-media policies remain unchanged, with
  a CSP regression test covering both file and loopback app origins.
  `packages/client-core/src/{useStreamingVoiceMode,useVoiceCall,useVoiceRecorder,voice-call-machine}.ts`,
  `packages/client-platform-web/src/{audio-capture,pcm16}.ts`,
  `packages/desktop-host/src/security.ts`, `apps/desktop/src/voice-call/`.
- [high, desktop/focus/voice-handoff, RESOLVED 2026-07-22] Voice Mode state
  lived independently in each renderer, so entering Focus Mode from an active
  full-window call showed an idle widget and forced the user to end and restart
  the conversation. The main renderer now retains ownership of the recorder,
  transcriber, active turn, waiting tone, and Piper queue while a narrow
  same-origin bridge mirrors only validated presentation state and bounded
  spectrum frames into Focus Mode. Focus controls route back to that owner, so
  mute, waiting sound, retry, and end-call actions keep operating on the same
  conversation. The first inactive-to-active handoff expands the Focus controls
  immediately, while a later explicit collapse remains respected. The microphone
  control now highlights the listening state and removes that highlight when
  muted, matching its crossed-microphone treatment. Initial Focus hydration uses
  bounded snapshot retries until the main owner responds, so one lost startup
  message cannot leave the widget in its local idle state. Every cross-realm
  message is Zod-validated, workspace-scoped, and excludes transcript text, tool
  data, and STT payloads. Regression tests exercise a real BroadcastChannel
  handoff through React StrictMode's effect replay, dropped startup delivery,
  automatic presentation activation, manual-collapse persistence, cross-realm
  Uint8Array validation, control routing, and waveform continuity. Owned bridge
  ports are recreated for every effect setup, so StrictMode cleanup cannot leave
  the live main renderer subscribed through a closed BroadcastChannel.
  `apps/desktop/src/voice-call/{desktop-voice-call-bridge,useDesktopVoiceCallBridge}.ts`,
  `apps/desktop/src/{chat,focus}/`.
- [med, desktop/focus/voice, RESOLVED 2026-07-22] Focus Mode exposed only the
  one-shot speech-to-text recorder, forcing users back into the full desktop
  chat for a continuous half-duplex conversation. Both surfaces now share one
  desktop Voice Mode adapter over the same headless call machine, VAD, Local
  Piper queue, waiting sound, mute intent, tool feedback, and active ask state.
  Focus adds compact start, end, retry, mute, and waiting-sound controls; the
  live indicator remains visible when the widget is collapsed, and switching
  from one-shot capture releases that recorder before the full call opens.
  While the call is active, the one-shot STT affordance stays absent and the
  mute action uses a distinct crossed-microphone treatment. The existing Focus
  spectrum now follows the live microphone analyser while the user speaks and
  the Piper output analyser while Moxxy answers, with output taking priority so
  the half-duplex transition cannot display the wrong source.
  Deterministic in-memory capture tests cover background persistence, resource
  ownership, controls, bidirectional visualisation, and preflight failure
  without changing STT or its IPC payload. `apps/desktop/src/focus/`,
  `apps/desktop/src/voice-call/useDesktopVoiceCall.ts`.
- [med, desktop/voice/speech-ux, RESOLVED 2026-07-22] The Markdown speech
  normalizer forwarded visual Unicode glyphs and incomplete emphasis markers
  into Piper, which pronounced emoji accessibility names and dangling stars.
  The shared read-aloud/Voice Mode preparation path now removes complete emoji
  sequences, flags, keycaps, dingbats, modifiers, joiners, and leftover stars
  without changing the rendered chat message. Pure regressions cover Polish
  prose, compound emoji, flags, keycaps, emoji-only replies, and both speech
  surfaces. `packages/client-core/src/{speech,speech.test}.ts`.
- [med, desktop/voice/turn-feedback, RESOLVED 2026-07-22] The initial
  one-second TTS acknowledgement treated every turn as work, so even a greeting
  produced an unnatural "Jasne, moment" before the real answer. It also started
  narrating a tool immediately instead of reserving speech for genuinely long
  operations. Ordinary response latency now uses the reviewed 1.6-second CC0
  default UI SFX processing loop played from a packaged desktop asset and looped
  without allocating repeated blobs. It begins while
  transcription is in flight, keeps playing through the same turn, pauses before
  spoken cues, stops when assistant speech wins the race, and can be disabled
  through a persistent, accessible call control. The pinned source checksum and
  license notice ship with the repository; there is no network or runtime
  dependency. Spoken progress starts only after an actual tool remains
  active for 10 seconds and is never mixed with the waiting phrase.
  `packages/client-core/src/{voice-feedback-scheduler,useVoiceCall}.ts`,
  `packages/client-platform-web/src/tts.ts`, `apps/desktop/src/voice-call/`.
- [med, desktop/voice/speech-ux, RESOLVED 2026-07-22] Live Voice Mode reused
  read-aloud's spoken `(code block)` placeholder, which switched Piper to the
  English voice and announced implementation artifacts that added no value to
  the conversation. Voice conversation playback now has a separate Markdown
  policy that omits fenced, unfinished, and indented code while leaving the
  transcript and explicit Read aloud behavior unchanged. The same pass replaces
  unclear progress copy and exposes only the scheduler's safe activity category
  to a theme-aware indicator beside the orb, without tool names or inputs.
  `packages/client-core/src/{speech,speech-playback-queue,useStreamingVoiceMode,useVoiceCall}.ts`,
  `apps/desktop/src/voice-call/`.
- [high, desktop/voice/conversation, RESOLVED 2026-07-22] Voice Mode consumed
  only assistant text chunks, so a direct tool call produced no audio until the
  tool and the following model round finished — leaving long-running work silent
  for minutes. A headless feedback scheduler now derives each turn's PL/EN
  language from the initiating prompt, narrates only safe tool-action categories,
  emits a bounded 10s → 30s → 90s heartbeat cadence only while a tool is active,
  and cancels ephemeral cues when real assistant speech arrives. Spoken progress
  clips share the ordered Piper queue, never enter chat history, and never
  narrate model-controlled tool inputs; ordinary latency uses a separate local
  looping processing pulse that never enters the Piper queue or conversation log.
  A dispatch failure reported by the real `useChat` store before any turn starts
  now terminates the cycle visibly instead of leaving Voice Mode in `thinking`.
  `packages/client-core/src/{voice-feedback-scheduler,speech-playback-queue,useVoiceCall}.ts`.
- [med, desktop/voice/ux, RESOLVED 2026-07-22] Voice Mode carried a separate
  hard-coded amber, cream, and near-black palette instead of the desktop's
  semantic theme tokens, and its pause control existed only while actively
  listening. The call surface and audio-reactive orb now share Moxxy's pink
  brand token across light and dark themes, with accessible focus, reduced
  motion, and reduced transparency states. Microphone mute is now persistent
  call intent owned by the headless state machine: it can be changed while
  Moxxy is thinking or speaking, survives turn completion, and prevents the
  recorder from restarting until the user explicitly unmutes it.
  `apps/desktop/src/voice-call/`,
  `packages/client-core/src/{voice-call-machine,useVoiceCall}.ts`.
- [high, desktop/voice/language-routing, RESOLVED 2026-07-22] The streaming
  language detector inherited the previous Piper voice for every tied score,
  while its English marker set was too narrow for ordinary phrases and the
  spoken code-block placeholder. A Polish sentence could therefore pin all
  following English chunks to Gosia. The deterministic detector now covers
  conversational PL/EN vocabulary and lightweight orthographic signals, keeps
  voice inheritance only for genuinely ambiguous single-token fragments, and
  has a queue-level regression for Polish-to-English switching. Verified end
  to end with real cached Gosia → Amy → Gosia synthesis and valid WAV output.
  `packages/client-core/src/{streaming-speech,speech-playback-queue}.test.ts`,
  `packages/client-core/src/streaming-speech.ts`.
- [med, desktop/voice/prosody, RESOLVED 2026-07-22] Streaming speech split
  responses into natural chunks but synthesized every chunk at the same speed
  and started the next clip immediately, discarding the SDK's existing `rate`
  capability and producing a flat cadence. A deterministic, reusable prosody
  planner now derives conservative rate and pause profiles from punctuation and
  sentence length; the playback queue forwards rate through a finite/bounded
  Zod-validated IPC field, preserves one-ahead prefetch, clears pending pauses
  on cancel, and keeps Voice Mode half-duplex until the final pause completes.
  `packages/client-core/src/{speech-prosody,speech-playback-queue}.ts`,
  `packages/desktop-ipc-contract/src/{commands,validation}.ts`,
  `packages/desktop-host/src/ipc/session.ts`.
- [high, desktop/dev-runtime, RESOLVED 2026-07-22] Desktop dev resolved a global
  `moxxy` binary from PATH before the freshly built monorepo CLI, so `pnpm build`
  could succeed while the app silently ran stale runtime code. Resolution now
  keeps an explicit `MOXXY_CLI_ENTRY` first, then prefers the local
  `packages/cli/dist/bin.js`, and only falls back to PATH outside a built repo.
  Packaged desktop remains pinned through its explicit bundled entry.
  `packages/desktop-host/src/{cli-resolver,cli-resolver.test}.ts`.
- [high, desktop/voice/config, RESOLVED 2026-07-22] The unified manifest exposed
  `plugins.synthesizer.default`, and live category switching persisted it, but
  session boot omitted the synthesizer from `applyPluginsTree`. Plugin discovery
  order therefore silently overrode the user's choice (for example ElevenLabs
  stayed active even when the config named `local-piper`). Session boot now
  applies the registered synthesizer default, with a regression test covering
  two installed TTS plugins and Local Piper selected second.
  `packages/cli/src/setup/{apply-plugins-tree,apply-plugins-tree.test}.ts`.
- [high, desktop/voice/privacy, RESOLVED 2026-07-22] Voice capture was not pinned
  to the workspace that opened the microphone, and unmounting the composer called
  `stop()`, which could finalize and transcribe into whichever workspace became
  active next. Capture now snapshots `workspaceId`, exposes a true discard path,
  rejects late microphone/transcription completions by generation, and releases
  every track without producing an STT request. The new half-duplex Voice Mode
  uses the same invariant across automatic listen, transcribe, Piper playback,
  reconnect, pause, and close transitions.
  `packages/client-core/src/{useVoiceRecorder,useVoiceCall}.ts`,
  `packages/client-platform-web/src/audio-capture.ts`.
- [high, desktop/voice, RESOLVED 2026-07-22] Desktop read-aloud swallowed every
  runner-side synthesis failure and silently switched to the Apple system voice;
  local Piper also returned native external ArrayBuffers that Electron's advanced
  IPC serializer rejects. Piper now requests and copies V8-owned samples, real
  errors remain visible, language hints reach the runner, and desktop Voice Mode
  streams sentence/clause chunks through a one-ahead playback queue with automatic
  Polish/English routing. Verified with real Gosia/Amy models under Electron-as-Node.
  `packages/plugin-tts-local/src/host-protocol.ts`,
  `packages/client-core/src/{speech-playback-queue,useStreamingVoiceMode}.ts`,
  `apps/desktop/src/chat/`.
- [med, chat-ux, RESOLVED 2026-07-23] Desktop ignored the live registry's
  `ToolInfo.compact` metadata even though TUI already consumed it, so the same
  Read/Grep/Glob run became a compact activity trace in one surface and a stack
  of generic tool cards in the other. Desktop now feeds the serializable
  metadata from `session.info` into the shared incremental fold (including the
  extension-sliced path); both surfaces render the resulting tool/skill work as
  compact, expandable activity rows and animate only active labels with a
  reduced-motion-safe shimmer. `packages/client-core/src/chatModel.ts`,
  `packages/plugin-cli/src/components/chat/`, `apps/desktop/src/chat/`.
- [med, providers, RESOLVED 2026-07-23] Bracketed model variants such as
  `claude-sonnet-4-6[1m]` no longer miss the catalog and inherit an unrelated
  `models[0]` context window: `resolveModelContext` now resolves the exact base
  descriptor before its last-resort fallback, with regression coverage.
  `packages/sdk/src/compactor-helpers.ts`.
- [high, modes, RESOLVED 2026-07-05] Goal mode killed its own runs and never let
  go: the iteration cap (150), a 4M token budget, and a stuck-loop FATAL abort
  (whose near-repeat heuristic trips on a legitimate edit→build→test cycle) all
  ended unattended runs mid-delivery, and the checkpoint injection budget never
  reset within a turn so the 4th *spread-out* idle nudge died with "checkpoint
  budget exhausted". Worse, `/goal` persisted `goal` as the config-wide mode
  default (future sessions BOOTED autonomous) and flipped session-wide
  yolo/auto-approve that nothing ever reverted. Fixed: goal runs are
  guardrail-free (terminals only: complete/abandon/idle-stall/abort/fatal; stuck
  trips now steer via `stuck.action: 'nudge'`), the injection budget is
  per idle-episode (`react-loop.ts`), and goal is `ModeDef.transient` — arms per
  objective, reverts to `ctx.previousModeName` on completion, refused as a
  boot/category default, and no channel flips session-wide approval anymore
  (the run's own scoped resolver auto-approves).
- [low, cli/security-dx, RESOLVED 2026-07-05] `moxxy channels rotate-token <name>` now wraps
  the SDK-only `rotateChannelToken` (SECURITY.md recommended rotation but no CLI exposed it):
  a reserved verb rotates `~/.moxxy/<name>-token` (the mobile channel's file convention) as a
  pure file op and prints a "clients must re-pair" notice.
  `packages/cli/src/commands/channels.ts`, `packages/cli/src/bin.ts`.
- [med, cli, RESOLVED 2026-07-05] One-shot commands (`-p`, `schedule run`, `doctor`, `login`,
  `init`) draining persistence before exit — VERIFIED already handled: the shared
  `closeSession()` (`flush()` → `settleWrites()` → `session.close()`) is awaited in each
  command's `finally`, ahead of `bin.ts`'s `process.exit`. Stale entry; kept as a
  regression-covered invariant. `packages/cli/src/setup/close-session.ts`.
- [med, desktop/config, RESOLVED 2026-07-05] `provider.setEnabled` "lost update" race —
  VERIFIED already fixed: the store moved off the stale `ipc/preferences.ts` pointer into
  `@moxxy/config`, whose read-modify-write runs inside a module-level `configMutex`; added a
  two-concurrent-toggles no-lost-update regression test.
  `packages/config/src/user-config.ts`, `packages/config/src/user-config.test.ts`.
- [med, apps, RESOLVED 2026-07-05] `RENDERER_DISPATCHED_METHODS` disjointness/exhaustiveness vs
  the host `BridgeServices` map was runtime-test-only (drift compiled fine). Now compile-enforced:
  `BridgeMethod = RendererDispatchedMethod | HostDispatchedMethod`, the renderer Set built from a
  `Record<RendererDispatchedMethod, true>` table, `BridgeServices` a mapped type keyed by
  `HostDispatchedMethod`, plus two equality guards (exhaustive over `keyof BridgeMethods` +
  disjoint). Member lists unchanged; runtime tests kept as belt-and-suspenders.
  `packages/desktop-app-sdk/src/bridge.ts`, `packages/desktop-app-sdk/src/index.ts`,
  `packages/desktop-host/src/apps/bridge-host.ts`.
- [low, mobile, RESOLVED 2026-07-05] Standalone `moxxy mobile` left `MOXXY_SESSION_SOURCE` unset,
  so the runner's env heuristic stamped the empty pre-first-prompt session `'tui'` and dropped it
  from the mobile list until its first prompt. Fixed by declaring `sessionSource:'mobile'` on
  `mobileChannelDef` and making `applyDedicatedRunnerEnv` stamp a DECLARED source even for
  non-dedicated channels (caller-pinned env still wins).
  `packages/plugin-channel-mobile/src/index.ts`,
  `packages/cli/src/commands/start-registered-channel.ts`.
- [low, mobile, RESOLVED 2026-07-05] Mobile UI grab-bag: migrated `QrScannerSheet`'s deprecated
  RN `SafeAreaView` to `react-native-safe-area-context`; removed dead `ToolGroupUi.accent`/`tint`
  fields; deleted the unused `LargeHeader` component. `apps/mobile/src/components/QrScannerSheet.tsx`,
  `apps/mobile/src/toolGroupUi.ts`, `apps/mobile/src/ui/kit.tsx`.
- [med, desktop/vite-build, RESOLVED 2026-07-05] transformers.js's ORT glue
  `new URL('…jsep.wasm', import.meta.url)` made Vite emit a ~21 MB ORPHAN wasm into `dist/assets/`
  on every bundle (dead path — the NER worker sets `wasmPaths=/ort/`, so `locateFile` always wins).
  Added an `ortWasmDropOrphan()` renderer plugin deleting the hashed `assets/` orphan in
  `generateBundle`; the real `dist/ort/…jsep.wasm` copy (`writeBundle`, unhashed name, outside the
  Rollup bundle) is untouched — verified in an isolated repro. `apps/desktop/electron.vite.config.ts`.
- [low, desktop/local-provider, RESOLVED 2026-07-05] The desktop Configure sheet prompted for a
  non-existent API key on the keyless `local` provider (core reports its placeholder-key authKind
  as `api-key`). Added `providerNeedsNoKey()` (keyed off the canonical `local` slug) to show a
  "no key needed" note instead of a key input. `apps/desktop/src/settings/ProvidersTab.tsx`.
- [low, desktop-host/channel-catalog, RESOLVED 2026-07-05] The hand-mirrored `channel-catalog.ts`
  had no test catching drift from the source of truth. Added a drift guard importing each channel
  plugin's `ChannelDef` directly and asserting vault keys / required / secret-type / `hasWebhookUrl`
  match (keyed by `vaultKey`) — silent drift now fails a test. (Removing the duplication via
  `channels describe --json` remains a separate follow-up.)
  `packages/desktop-host/src/channel-catalog.test.ts`.
- [med, modes, RESOLVED 2026-07-05] Every ReAct-shaped mode duplicated ~250 lines
  of loop plumbing — `mode-default`, `mode-goal`, and the collab agent loop each
  carried a divergent copy of retry back-off / reactive compaction / stuck
  detection / abort handling (collab's had NO back-off, so a sustained 429
  busy-looped it; default retried un-compactable overflows 6× before dying where
  goal failed fast). Extracted into `runReactLoop`
  (`packages/sdk/src/mode/react-loop.ts`) with per-mode policy hooks + a turn-end
  checkpoint gate (`TurnCheckpoint`); the three modes are now thin policy layers
  and the hardened semantics are unified (goal's overflow rule everywhere,
  bounded back-off everywhere).
- [med, security, RESOLVED 2026-07-03] `security.perPlugin` isolator overrides were
  a dormant config option: real sessions wired `buildSecurityPlugin` with
  `resolvePluginForTool: null` (plugin-level routing disabled), so the documented
  `perPlugin` schema key never routed anything. The CLI now resolves tool → owning
  plugin from the plugin host's loaded records (`PluginHost.ownerOfTool`, exposed on
  the SDK `PluginHostHandle` as optional so thin clients may omit it), which also
  powers the new `moxxy security audit --package <name>` / `--by-package` views and
  install_plugin's combined-capability report. `packages/cli/src/setup/builtins.ts`,
  `packages/core/src/plugins/host.ts`, `packages/plugin-security/src/index.ts`.
- [med, dx, RESOLVED 2026-07-03] `service install` units no longer break under
  Electron-as-node: `installAndStartService` detects `process.versions.electron`
  and exports `ELECTRON_RUN_AS_NODE=1` into the unit env, so a desktop-spawned
  install can't boot the GUI as a ghost daemon. The "prefer the Helper binary"
  half was deliberately skipped — the env var fully fixes launch semantics and
  the Helper path is packaging-layout-dependent.
  `packages/cli/src/commands/service/index.ts`.
- [low, sessions, RESOLVED 2026-07-03] `SessionSource` literals were hand-listed in
  one runtime spot (`sessionSource()`'s validator in
  `packages/cli/src/setup/persistence.ts`) — adding the Discord channel's
  `'discord'` source hit exactly the two-spot update this entry warned about, so
  the list is now a runtime constant: `SESSION_SOURCES` in `@moxxy/sdk`
  event-store.ts, with the `SessionSource` type DERIVED from it
  (`(typeof SESSION_SOURCES)[number]`) and the CLI guard doing an `includes()`
  against the same array. New sources are now a one-line change that can't be
  silently dropped by a stale validator.
- [dormant, browser, RESOLVED 2026-07-03] CDP screencast push path (`startScreencast`/
  `stopScreencast` sidecar handlers) — the entry was stale: the handlers were already
  deleted in the PR #212 quality sweep; only screenshot-polling remains (rationale in
  `packages/plugin-browser/src/browser-surface.ts`). A regression guard pins the former
  methods to `unknown method` (`packages/plugin-browser/src/sidecar/dispatch.test.ts`).
- [low, tools, RESOLVED 2026-07-03] `resolveSafe` deprecated alias for `resolvePath`
  removed (no callers remained). `packages/tools-builtin/src/util.ts`.
- [med, mobile, RESOLVED 2026-07-03] `apps/mobile` was the only package in the
  repo type-checking without `noUncheckedIndexedAccess` + `verbatimModuleSyntax`
  (it extends `expo/tsconfig.base`, not the moxxy base, so it silently missed the
  strict baseline). Both flags are now set explicitly in its tsconfig and the
  surfaced errors fixed. Gotcha: `expo-file-system` ships raw TS source
  (`"main": "src/index.ts"`) and the `/legacy` subpath has no `types` mapping, so
  tsc type-checked Expo's own source under the new flag — resolved by migrating
  the app's three read call sites off `expo-file-system/legacy` onto the modern
  SDK 54 `File` API (`new File(uri).base64()/.text()`), whose root import
  resolves through the shipped `.d.ts` where `skipLibCheck` applies.
  `apps/mobile/tsconfig.json`, `apps/mobile/src/pairingUrl.ts`,
  `apps/mobile/src/styles/tokens.ts`, `apps/mobile/src/hooks/useAttachments.ts`,
  `apps/mobile/src/hooks/useVoiceRecorder.ts`.
- [low, dry, RESOLVED 2026-07-03] Ad-hoc retry/backoff sleeps consolidated onto the
  sdk's shared `sleepWithAbort` (now surfaced directly on the barrel next to
  `nextBackoffMs`, not buried in the mode-helpers block): the runner's
  initial-connect retry + SIGTERM grace waits and the desktop supervisor's restart
  wait (`forceRetry` now aborts the sleep) / socket poll / kill grace. Schedules
  deliberately unchanged (linear connect retry, constant supervisor wait).
  `packages/runner/src/remote-session.ts`,
  `packages/desktop-host/src/runner-supervisor.ts`, `packages/sdk/src/index.ts`.
- [med, sessions, RESOLVED 2026-07-03] Event-log READS no longer cast blindly:
  all three JSONL parse sites (`restoreEvents`, `readEventPage`, index
  hydration) route through a shallow structural guard (`isMoxxyEventShape`)
  that skips wrong-shape-but-valid-JSON lines with the exact corrupt-line
  semantics (never throw mid-replay; restore counts them as
  `invalidShapeLines` and repairs the file). This closes the read-side leak in
  the EventStore trust boundary (Pillar 2 note below): a junk line can no
  longer drive replay (a `compaction` line missing `replacedRange` used to
  throw inside `projectMessagesFromLog`'s unconditional dereference). The
  guard is allocation-free per line, exhaustively typed against the
  `MoxxyEvent` union (variant drift fails the build), and deliberately keeps
  unknown NEWER event types with a valid envelope so a floor rollback can't
  rewrite away a newer version's history.
  `packages/core/src/sessions/event-shape.ts`.
- [low, focus, RESOLVED 2026-07-02] Focus Mode mini-chat no longer carries a
  separate text-only composer path: pasted screenshots now reuse the desktop
  attachment save/preview/send pipeline, zoomed image previews can be drag-panned,
  and the mini-text panel remembers the user's native-resized size through local prefs.
  `apps/desktop/src/focus/`, `apps/desktop/src/chat/image-preview/ImagePreviewModal.tsx`,
  `apps/desktop/src/chat/composer/useComposerAttachments.ts`,
  `packages/desktop-ipc-contract/src/{prefs,validation}.ts`,
  `packages/desktop-host/src/{prefs,focus-window}.ts`.
- [high, collab, RESOLVED 2026-07-01] Collaboration is now a SEPARATE feature on
  BOTH surfaces: the coordinator runs on its own dedicated `moxxy collab` runner
  (own Session + socket), never inside a chat session — no mode-flip, no team
  activity in a chat's thread. Desktop: the Collaborate panel supervises it
  (`CollabSupervisor`) over dedicated `collab.*` IPC + `collab.event`/`collab.approval`
  (a private `useCollab` hook, not `useChat`). TUI: `/collab` re-points the terminal
  onto the coordinator's own session via the in-place session switch (auto-submits
  the goal via `initialPrompt`; bare `/collab` attaches-to-view), reusing the whole
  SessionView (transcript, `CollabScopeView`, approval, step-in). `packages/cli/src/commands/{collab,run-tui}.ts`,
  `packages/desktop-host/src/collab-supervisor.ts`,
  `packages/plugin-cli/src/session/{run-slash,BootShell,SessionView,sessions-picker}.*`,
  `packages/mode-collaborative/src/{constants,collab-store,collab-lock}.ts`,
  `apps/desktop/src/collaborate/{useCollab.ts,CollaboratePanel.tsx}`.
- [low, ux, RESOLVED 2026-06-25] `SkillGallery` now uses the shared
  `<SearchBox />` primitive and has regression tests for filtering by name and
  description. `apps/desktop/src/settings/skills/SkillGallery.tsx`.
- [low, ux, RESOLVED 2026-06-26] Focus Mode's collapsed dark tile no longer
  exposes the white Electron webContents background at anti-aliased corners; the
  native focus window is shaped and the tile paints theme-aware backing color.
  `packages/desktop-host/src/focus-window.ts`,
  `apps/desktop/src/focus/focus-styles.ts`.
- [low, sessions, RESOLVED 2026-06-29] Resumed desktop sessions now hydrate
  stale sidecar titles from JSONL history and dedupe legacy `.meta.json` rows,
  so the workspace sidebar no longer falls back to duplicate/stuck
  `New session` labels. `packages/core/src/sessions/persistence.ts`,
  `packages/workspace-registry/src/index.ts`.
- [med, mobile, RESOLVED 2026-07-01] Moxxy Mobile Live Activity taps now route to
  an existing chat route, derive labels from real session/workspace state, and
  avoid false completion notifications on transient background disconnects.
  `apps/mobile/src/liveActivity.ts`,
  `apps/mobile/ios/MoxxyLiveActivityExtension/MoxxyLiveActivityWidget.swift`.
- [med, mobile, RESOLVED 2026-07-02] Moxxy Mobile now flushes the latest active
  Live Activity snapshot when iOS backgrounds the app, treats streaming assistant
  transcript as active work even when turn flags lag, dedupes same-session native
  ActivityKit activities, and keeps the lock-screen badge/detail compact.
  `apps/mobile/src/liveActivity.ts`,
  `apps/mobile/src/hooks/useMoxxyLiveActivity.ts`,
  `apps/mobile/ios/MoxxyMobileGateway/MoxxyLiveActivity.swift`,
  `apps/mobile/ios/MoxxyLiveActivityExtension/MoxxyLiveActivityWidget.swift`.
- [med, mobile, RESOLVED 2026-07-02] Moxxy Mobile active turns now reconcile
  missed lifecycle completion pushes from the runner's authoritative history,
  so a foregrounded/reconnected phone does not keep showing Thinking/Live
  Activity after desktop already received the final answer.
  `packages/client-core/src/chat-store/store.ts`,
  `apps/mobile/src/hooks/useGatewayStore.tsx`.
- [med, mobile, RESOLVED 2026-07-02] Moxxy Mobile reconnect recovery now also
  reconstructs missed turn starts from runner history and performs a one-shot
  foreground/reconnect refresh even before `activeTurnId` is known, so Live
  Activity can restart from authoritative state after the phone missed the
  `runner.turn.started` push.
  `packages/client-core/src/chat-store/store.ts`,
  `apps/mobile/src/hooks/useGatewayStore.tsx`.

## Standing practices

- **Own debt like a CTO** — read this file before non-trivial work, retire ≥1 item
  per change, log new debt on sight, re-audit subsystems during big work.
- **Rebuild after changes** — turbo cache makes `pnpm build` cheap; run it (and the
  gate) before reporting work done or rebasing onto main.
- **Keep the Claude skill library current** — `.claude/skills/` encodes repo
  conventions; when a convention/command/invariant changes, update the matching
  SKILL.md in the same PR.
- **YAGNI extension seams** — subagent retention constants, discovery concurrency,
  `credentialResolver` capability, per-owner browser sidecar registry, warm
  subprocess pool are consciously deferred (surface/risk for no current win);
  revisit when a concrete need appears.
- **Goal runs have no spend ceiling — on purpose (2026-07-05).** Guardrails
  (iteration cap, token budget, stuck-abort) killed real deliveries, so goal mode
  removed them by explicit product decision; the backstops are the always-visible
  GOAL badge, Esc/abort, the idle-stall soft-terminal, and stuck-NUDGE steering.
  If runaway-spend reports appear, add an opt-in `context.goal.budget` config
  (off by default) rather than reintroducing silent hard stops.

## Sessions / workspace

- [low, scale] `desks.list` derives in O(N) `stat`s (one `readdir` + a `stat` per
  session file; parses only changed files via the mtime cache). Fine for hundreds–
  low thousands; at very large N a registry-level derived-cache invalidated by the
  sessions-dir watcher would make it O(1). `packages/core/src/sessions/persistence.ts`.
- [low, scale] `desks.changed` ships the full desk list (O(N) payload); a delta
  event (changed desk/session only) would cut cross-device payload to O(1). The
  projection-diff already suppresses per-event churn. `packages/desktop-host/src/sessions-watcher.ts`.
- [note] Stress-test multi-session with a desk's SECOND (UUID) session — the first
  session has id === desk id, which masks pool-key regressions. `packages/desktop-host`.
- [low] TUI `/sessions` switcher only works in self-host/standalone mode (the TUI
  owns the boot, so it can re-bootstrap onto a different session in place). In
  ATTACH mode (thin client against an external `moxxy serve`) the runner owns a
  single fixed session, so the switcher degrades to a notice. True attach-mode
  switching needs a runner-side session pool (like desktop's `RunnerPool`) or a
  spawn-a-second-runner flow; deferred as the larger architectural change.
  `packages/cli/src/commands/run-tui.ts`, `packages/plugin-cli/src/session/sessions-picker.ts`.
- [low] TUI `/sessions` switch re-runs the full `setupSessionWithConfig` per switch
  (re-discovers plugins, re-fires onInit daemons for the new session). Correct but
  not cheap; a warm-registry / session-pool reuse would make switching instant.
  `packages/cli/src/commands/run-tui.ts`.

## Mobile / Live Activity

- [med, mobile, PARTIALLY DONE] Moxxy Mobile's Live Activity can only update from
  local JS while the app process is alive. Local backgrounding now flushes the
  latest known active state, native duplicates are cleaned up, and foregrounded
  clients can recover missed starts/completions from runner history, but if the
  phone is already fully suspended before a desktop turn starts, iOS may pause
  the WS client before any local ActivityKit update can be sent. Confirmed on
  2026-07-02 with iPhone 17 Simulator: a desktop-gateway turn started while the
  mobile app was locked produced runner/tool events, but no lock-screen Live
  Activity or completion notification until the app was foregrounded. Remaining:
  correct end-to-end background fidelity needs a push-backed ActivityKit update
  path (per-activity push token + APNs update/end from a relay/host) or an
  equivalent server-side bridge.
  `apps/mobile/src/hooks/useMoxxyLiveActivity.ts`,
  `apps/mobile/ios/MoxxyMobileGateway/MoxxyLiveActivity.swift`.

- [note, mobile, OTA] EAS Update runtime version uses the `appVersion` policy
  (not `fingerprint`) because iOS native is COMMITTED (`apps/mobile/ios/` holds
  custom Live Activity Swift, so no full CNG). The consequence: the iOS runtime
  version + updates URL live STATICALLY in `ios/.../Supporting/Expo.plist`
  (`EXUpdatesRuntimeVersion=1.0.0`, `EXUpdatesEnabled`, `EXUpdatesURL`), so when
  you bump `version` in `app.json` for a native release you MUST also update that
  plist (or re-run `expo prebuild -p ios`) or iOS builds silently stop matching
  their OTA channel. Android is CNG and reconfigured by EAS automatically, so it
  doesn't have this hazard. Recorded on purpose; revisit if the committed iOS
  project is ever replaced by prebuild-on-build.
  `apps/mobile/app.json`, `apps/mobile/app.config.ts`,
  `apps/mobile/ios/MoxxyMobileGateway/Supporting/Expo.plist`.

## Runner / protocol & architecture

- [note, dry] Three inline backoff/retry implementations remain ON PURPOSE and must
  not be "deduped" onto `@moxxy/sdk`'s `sleepWithAbort`/`nextBackoffMs`:
  `client-transport-ws/src/json-rpc-client.ts` (cancellable-timer reconnect; the
  sdk barrel statically reaches `node:fs/promises`, which breaks its Metro/RN
  bundle — rationale commented at the site), `plugin-channel-web/src/frontend/
  socket.ts` (browser bundle), `plugin-provider-claude-code/src/login.ts`
  (bespoke OAuth retry). Revisit only if the sdk grows a dependency-free
  browser-safe subpath (like `@moxxy/sdk/tool-display`).
- [high, architecture] Retype channel handlers to the SDK contract — `ClientSession`
  still exposes the full concrete registry surface; retype handler params to a
  minimal `SessionLike` slice (and verify graceful degradation) alongside the
  runner/thin-client split. `packages/sdk/src/session-like.ts`, `plugin-cli`, `plugin-telegram`.
- [high, bug] `/new` desync window — renderer clears the store before the runner
  reset confirms; a failure/crash between them resurrects old context. Reset runner
  FIRST, clear on success (or one atomic IPC). **Zero tests** on this path.
  `packages/desktop-host/src/chat-log.ts`, `packages/runner/src/`.

## Desktop / native build & release

- [high] node-gyp 9 too old / 11 hangs `@electron/rebuild@3.6.1` ("preparing
  node-pty"). Real fix is a coupled bump: `@electron/rebuild` 4.x, electron-builder
  25→26, node-gyp 12, Node floor `>=20.17` — verified by an actual packaging run.
  Until then CI pins stay (Python 3.11 + windows-2022); use `verify-desktop-packaged`
  for any node-gyp change. `root pnpm.overrides`, CI.
- [med] Verify Tier-1 hot-update sticks on 0.0.30+; once verified, consider dropping
  the renderer-heartbeat confirm path (fast-path kept). `packages/desktop-host/src/app-update/`.
- [low] Pre-fix releases (≤ desktop-v0.8.0) carry mismatched GitHub asset names
  (manual repair); only new releases are correct.

## Desktop / surfaces & files

- [high, constraint] Surfaces are ref-counted — keep the per-kind refcount balanced
  if adding open/close call sites (a single viewer's close must not destroy a shared
  instance). `packages/core/src/surfaces/host.test.ts`.
- [constraint] Terminal sizing depends on the pane being full-width at mount — never
  push a transient/sub-full column count to a PTY-backed surface. Guarded renderer-side
  (120px-width floor + rAF-coalesced fit in `apps/desktop/src/shell/surfaces/TerminalPane.tsx`)
  and validated/clamped in `packages/plugin-terminal/src/{terminal,pty}.ts`; keep new
  viewers behind the same guard.
- [dormant] Piped-shell fallback is intentionally non-interactive — needs CR→LF +
  local echo if a no-prebuild platform ever needs it (the degraded state IS surfaced
  to the viewer). `packages/plugin-terminal/src/pty.ts`.
- [low] Files pane polls IPC instead of streaming via the Surface protocol — promote
  to a real Surface if a third live pane appears. `apps/desktop/src/shell/surfaces/`.
- [low] "Add to agent" on a git-changed file assumes cwd === repo root: `git status`
  paths are repo-root-relative, but `FilesPane` builds `absPath = cwd + relPath`, wrong
  when the session cwd is a repo subdir (the same mismatch hits the diff viewer's
  `confineDiffPath`). No repo-root is exposed to the renderer; the fix needs a new
  `git.root` IPC (`ipc/git.ts` + contract). `apps/desktop/src/shell/surfaces/FilesPane.tsx`.
- [low] Terminal tool completion is sentinel-heuristic; a structured exec channel
  would be cleaner. `packages/plugin-terminal/`.

## Desktop / apps & send-to-chat

- [med] `session.send` not reachable by sandboxed apps — the iframe runtime /
  postMessage↔IPC relay doesn't exist yet (only the built-in anonymizer path ships).
  `apps/desktop/src/apps/`.
- [med] NER model E2E only unit-verified — confirm model loads from `moxxy-app://`
  with zero network in a packaged/dev Electron run. `packages/desktop-host/src/apps/`.
- [med] transformers.js ↔ ORT wasm version coupling + installer↔HF asset-path
  coupling — re-verify packaged NER on any bump; keep the two path ends in lockstep.
  `packages/desktop-host/src/apps/registry.ts`.
- [low] No on-disk integrity check for installed app assets — add per-asset sha256
  when the model set stabilizes. `packages/desktop-host/src/apps/`.

## Anonymizer & NER

- [med] Polish NER recall unproven (cross-lingual transfer) — needs a real-Polish-doc
  eval harness or the `jiting/...hrl_onnx` fallback. `packages/anonymizer/`.
- [low] Crypto/secret checksums are structural-only (no crypto dep); no HIPAA
  Safe-Harbor profile; context window is a flat 48 chars. `packages/anonymizer/`.

## Desktop / attachments, settings, providers

- [med] Dropped attachments are invisible — two silent skip sites only `console.warn`:
  `authorizeAttachments` (`ipc/session.ts`, sync, drops unauthorized-provenance paths; its
  `dropped[]` is already available) and `buildAttachments` (`attachments.ts`, skips
  oversized/binary/unextractable files) which runs ASYNC inside `session-driver.ts`'s
  fire-and-forget pump AFTER the IPC `{turnId}` already returned. A user notice needs a
  contract transport (a `droppedAttachments?` field on `RunTurnResult` and/or a
  `skippedAttachments?` on `runner.turn.complete`), emission from `session-driver.ts`, and
  renderer display — no generic notice channel exists to reuse (only `error{kind:'fatal'}`
  renders, which would read as a turn failure).
  `packages/desktop-host/src/{ipc/session.ts,attachments.ts,attachment-authz.ts}`.
- [low] Configure sheet can't edit a built-in provider's models array — a genuine
  feature, not a bug: provider-admin (`plugin-provider-admin`) intentionally throws
  `CONFIG_INVALID` on `configure()` of a built-in (they are code, not stored config),
  so exposing model-array editing needs new runner-side persistence for built-in
  overrides. (The sibling `local`-wizard non-existent-key prompt is FIXED — see ledger.)
  `apps/desktop/src/settings/providers/`.

## Providers & model catalogs

- [note, provider-audit, 2026-07-06] Claude Code installed-CLI flow audited across setup, runner, desktop, and release gates. Live coverage now proves a subscription-backed streamed prompt plus an observable native-tool edit confined to a generated temporary git repository; desktop coverage pins missing-binary, cancelled, successful, and failed sign-in outcomes without credential echo. Remaining limitation is intentional: headless/services cannot reliably perform interactive Claude authentication and must reuse a same-OS-user login completed beforehand. Claude CLI—not moxxy's permission resolver—owns native-tool permission enforcement. `scripts/e2e-claude-cli-live.mjs`, `packages/desktop-host/src/provider-login.test.ts`, `apps/desktop/src/settings/shared/OAuthSignIn.test.tsx`.

- [med] Codex reasoning isn't round-tripped (`toResponsesInput` drops the reasoning
  block); Anthropic multi-block thinking collapses to one round-trip block. Only
  Anthropic round-trips fully. `packages/plugin-provider-*/`.
- [low] Hardcoded catalogs span 5+ providers and drift — a shared
  OpenAI-compatible-vendor catalog or `/v1/models`-backed refresh would self-update.
- [med] Advertised `contextWindow` values are trusted blindly by the proactive
  compactor (`estimatedTokens > 0.75 * contextWindow`, `compactor-summarize`). When
  a catalog overshoots the backend-enforced window, the proactive gate becomes
  unreachable and every long session degrades to the reactive compact-on-overflow
  retry (`react-loop.ts` `isContextOverflowError`). Fixed one instance (Codex
  gpt-5.5/gpt-5.4 1M→400k) but the failure mode is latent for any future catalog
  drift; consider calibrating the effective window from real provider `usage` /
  observed overflow rather than the static descriptor. `resolveModelContext`
  now recognizes terminal bracket variants such as `[1m]`; genuinely unknown
  ids still fall back to `models[0]` with a one-shot warning. Remaining: calibrate
  the *effective* window from observed usage/overflow rather than the static descriptor.

## Channels, relay & HTTP

- [low] Discord channel pairing is terminal-only: the DM code flow (bot DMs a
  one-time code → operator pastes it into `moxxy discord pair`) has no GUI
  completion path, so the desktop Channels panel can start the bot dedicated
  (window armed, codes issued) but the paste must happen in a terminal, and the
  already-running dedicated runner only reloads the authorized principal at
  start — pairing from the desktop means run `moxxy discord pair`, then restart
  the channel. A `channels.confirmPairingCode` control-surface hook (status-file
  or IPC) would close both gaps. `packages/plugin-channel-discord`.
- [low] Desktop channel catalog is a MIRROR: each channel self-describes its config on
  `ChannelDef.config` (`fields`/`vaultKey`/`hasRequestUrl`/`runHint`), which the TUI
  `/channels` panel + `moxxy channels` read from the live registry, but the desktop
  `channel-catalog.ts` hand-copies it (the Electron main avoids booting plugin discovery).
  A drift test now guards silent divergence (see ledger); the remaining follow-up is
  REMOVING the duplication via a `moxxy channels describe --json` the desktop consumes.
  `packages/desktop-host/src/channel-catalog.ts`.
- [low] Desktop-spawned channels are killed on app quit (a best-effort
  `process.once('exit')` SIGTERM in `channel-supervisor.ts`). The TUI/CLI surfaces
  now run channels DETACHED + status-file-discovered (`@moxxy/sdk/server`
  `channel-control.ts`: `spawn`/`liveChannelStatus`/`listLiveChannelStatuses`/
  `stop`), so they survive their launcher and re-adopt across restarts. The
  desktop supervisor could converge onto the same status-file model (discover +
  optionally adopt rather than always child-handle + kill-on-quit).
  `packages/desktop-host/src/channel-supervisor.ts`.
- [med] Relay is the single-instance sole remote path — no fallback; needs uptime
  monitoring + redeploy story (decide on an emergency escape hatch). `plugin-tunnel-proxy`.
- [med] Channel→core prod dependency — `plugin-cli`/`plugin-telegram` still import
  core helpers; hoist provider-neutral ones into the SDK. 
- [med, PARTIALLY DONE 2026-07-03] Shared HTTP-channel server base —
  `createServer`/`listen`/health/routing is replicated across
  `plugin-channel-http`/`-web`/`webhooks`/`ipc-server-ws`. The Slack copy is
  RETIRED: `@moxxy/channel-kit` now owns the inbound-webhook scaffold
  (`IngestHttpServer`: routing/health/size-capped raw body/verify gate/500
  catch-all + `DeliveryDedupeCache`) and Slack's ingest is a thin pipeline on
  it. Migrating the remaining four is still the larger, lower-payoff refactor.
- [note, whatsapp, security] `@moxxy/plugin-channel-whatsapp` is the first channel
  on an UNOFFICIAL client (Baileys / WhatsApp Web protocol): automating an account
  violates WhatsApp's ToS and the number can be permanently BANNED. Two standing
  tradeoffs recorded on purpose: (1) the rotating Baileys auth-state (signal
  sessions/pre-keys/creds) is stored UNENCRYPTED at rest under
  `~/.moxxy/whatsapp-auth` (dir 0700, files 0600) — the vault is the wrong home for
  a high-write rotating key store, so it isn't used; anyone with file access to the
  moxxy home can hijack the linked session. The `WhatsAppAuthStorage` interface
  exists so an encrypted backend can be swapped in later without touching the
  channel. (2) permission prompts are PLAIN-TEXT numbered replies (Baileys has no
  reliable multi-device interactive buttons), captured as the owner's next short
  message. Follow-ups: encrypted auth-state backend; per-chat concurrency (single
  global `busy` today, like Slack v1); richer formatting.
  `packages/plugin-channel-whatsapp/`.
- [note, channels] Channel scaffolding shared by telegram+slack+signal+whatsapp
  now lives in `@moxxy/channel-kit` (FramePump, TurnCoordinator + turnId-filtered
  turn helpers, host-code + TOFU pairing machines, `resolveSecret`, audited
  allow-list resolver, ingest scaffold, PlainTurnRenderer). Signal + WhatsApp
  (2026-07-03) validated the thin-adapter claim: both consume
  TurnCoordinator/driveTurn/PlainTurnRenderer/resolveSecret (Signal also
  createAuditedAllowListResolver, WhatsApp also FramePump) and add only their
  messenger's quirks. New channels (Discord) should be thin adapters over it —
  messenger quirks (formatting, transport error mapping, signature schemes,
  pairing wording) stay in each plugin.
  Deliberately NOT extracted (single-implementation or channel-specific):
  Telegram's rich TurnRenderer/HTML pipeline + inline-keyboard
  permission/approval prompts + grammy dispatch, Slack's HMAC verify + zod
  envelope schema + Web-API client, both setup wizards/pair flows.
  `packages/channel-kit/`.
- [med, slack v1] Slack channel runs a SINGLE global `busy` single-flight — one
  turn at a time across ALL threads/channels (a 2nd @mention while busy gets a
  "still working" reply and is dropped). Per-thread concurrency (a turn per
  thread, the isolation seam supports it) is deferred. `packages/plugin-channel-slack/`.
- [med, slack v1, security] Slack channel is AUTONOMOUS — allow-list auto-approve
  with no human-in-the-loop (mirrors the HTTP channel). There is no Slack
  Interactivity button-approval flow; the operator must scope `allowedTools`
  narrowly at setup (every auto-approved call is logged). Revisit human-in-the-loop
  via Slack Interactivity (a 2nd Request URL) for v2. `packages/plugin-channel-slack/`.
- [low, slack v1] Slack replies stream as PLAIN TEXT via `chat.update` (no
  Block Kit / mrkdwn formatting, no message split for very long replies). A
  Telegram-style renderer + Block Kit would improve fidelity. `packages/plugin-channel-slack/`.
- [med, signal v1, security] Signal channel is AUTONOMOUS like Slack —
  allow-list auto-approve, no human-in-the-loop (every auto-approved call is
  logged). Signal has no server-side button UI, but a reply-keyword approval
  flow ("reply YES/NO to approve") over the deferred resolver is feasible for
  v2. Also v1 gates on a static sender allow-list edited only via the vault
  key / `--allowedSenders`; an `allow <number>` subcommand would help.
  `packages/plugin-channel-signal/`.
- [med, signal v1] Signal channel is direct-message only (group envelopes are
  dropped) and runs the same single global `busy` single-flight as Slack v1.
  Group support needs a group-id trust story + `groupId` send targets.
  `packages/plugin-channel-signal/`.
- [low, signal v1] Replies are plain-text buffered chunk sends (justified in
  `channel/chunker.ts` — Signal edits re-deliver the full body E2E per frame),
  so there is no live-updating draft; liveness is the typing indicator only.
  If signal-cli ever grows a cheap draft/edit path, revisit FramePump here.
  Daemon crash recovery is exit-fatal (supervisor restart), not in-process
  respawn. `packages/plugin-channel-signal/`.
- [med, security] LAN pairing is cleartext `ws://` (RN/Expo can't trust a self-signed
  cert for a private IP); the secure phone path is the tunnel (`wss://`). Add optional
  `https.Server` + dev-build pinning only if direct-LAN encryption ever matters.
- [low] Web-preview path-prefix rewriting only matters if a non-base-path-aware HTTP
  app appears. `packages/plugin-channel-web/`.
- [low] Telegram rich-formatting is "simple yet powerful" but the powerful half is
  doc-only: the model isn't TOLD about `~~strike~~`/`||spoiler||`/`> [!type]` callouts,
  so it uses them only when a prompt/skill asks. The auto-wins (collapse the tool trace,
  render standard Markdown) need no model awareness. If we want the model to reach for
  collapsible callouts on its own, inject a one-line capability note into the session
  when the Telegram channel is active (no prompt-injection seam for channels exists yet).
  `packages/plugin-telegram/src/format.ts`.
- [low] The final-frame activity collapse (`<blockquote expandable>`) is always-on with
  a fixed 4-line threshold; if anyone wants it off, promote it to a per-chat `/details`
  toggle or a `TelegramChannelOptions` flag. `packages/plugin-telegram/src/render.ts`.

## Workflows

- [med] `awaitInput` barred inside a loop body (needs mid-iteration checkpointing);
  multi-pause stress-tested only to two pauses; concurrent paused runs of the same
  workflow surface as separate asks (UI ordering policy). `packages/plugin-workflows/`.
- [med] Resume relies on the child retained in the runner's in-memory registry — a
  runner restart between pause and resume loses it (checkpoint survives, continue
  fails cleanly); persist/rehydrate is future work. `packages/plugin-workflows/`, `core/subagents`.
- [med] Mobile workflow builder name fields are free-text — populate from
  `workflows.list` like desktop. Add a settings error-row retry if `settings.read`
  failures prove common. `apps/mobile/app/workflow-edit.tsx`.
- [med] Cross-session `afterWorkflow` can't route: the `workflow_completed` event is
  observed in-process by ONLY the runner that ran the parent, so a dependent pinned
  (`targetSessionId`) to a different session is skipped with a warning rather than
  run there. A shared completion queue (mirror the webhooks queue/drain from #333)
  would let any runner pick up its own-target dependents. `packages/cli/src/setup/wire-run-store.ts`.
- [low] No validation that a trigger's `targetSessionId` names a live session: a
  stale/mistyped id silently never fires (schedule owner-gates to an absent runner;
  fileChanged/afterWorkflow skip on every runner). The desktop picker surfaces a
  "(missing)" option, but `webhook_create`/`schedule_create`/workflow YAML can't
  validate without a live-desk registry. `packages/plugin-{webhooks,scheduler}`, `packages/cli`.

## Config / plugins manifest

- [note, RESOLVED 2026-06-25] The three overlapping config stores (flat
  `provider`/`mode`/`compactor` keys + package-keyed `plugins:` map +
  `~/.moxxy/preferences.json`) are unified into one category-grouped `plugins:`
  tree with a critical floor (Pillar 1). Provider/mode/model/disabled now persist
  through `@moxxy/config` writers; `preferences.json` is gone.
- [note, RESOLVED 2026-06-25] Pillar 2 done: the **EventStore** behind the event
  log is now a registry kind (`eventStore`) with a protected JSONL floor and an
  explicit-opt-in trust boundary, behaviour-identical (thin adapter over
  `SessionPersistence`). Plan: `~/.claude/plans/i-think-we-need-zany-wirth.md`.
  2026-07-03: the read-side gap this boundary still leaked (JSONL lines cast to
  `MoxxyEvent` instead of validated) is closed — see the `isMoxxyEventShape`
  entry in the resolved ledger.
- [note, updated 2026-07-03] Pillar 3 is HALF done, not unstarted: #363/#364
  shipped the shared `provision()` engine + `moxxy provision`, reworked `init`
  (catalog + `ensureProvider` npm-installs on demand), and unbundled the 6
  API-key providers (published, fixed changeset group). Remaining, tracked in
  plan `~/.claude/plans/cheerful-booping-nebula.md`: unbundle the ~20 still-private
  discovery-loadable plugins in batches, pin on-demand installs to the CLI
  version (currently `latest`), desktop seed pack, TUI install/connect
  affordances.
- [low, follow-up] EventStore: only the WRITE path routes through the active
  store (`attachSessionPersistence` → `getActive().open()`). The session-scoped
  READS (`restoreSessionEvents`/`readSessionEventPage` in build-session, runner
  session-handlers, mobile host) + cross-session management (`listSessionMetas`/
  `deleteSession`/`seedSessionLog`) still call the standalone JSONL fns. Identical
  while JSONL is the only impl; route them through `getActive()` (and add a
  default-store seam for the no-session listing) when a 2nd store lands.
- [low, dx] plugins-admin/runner/channels persist via raw-YAML `setIn` writers in
  `@moxxy/config/user-config.ts` — the typecheck can't catch a wrong path string;
  keep the round-trip tests honest and grep for `['plugins'` paths on changes.

## CLI / services

- [med, channels, security] The serve.ts "first interactive channel wins the shared
  permission resolver" note is aspirational, not real: the `resolverSetByChannel`
  gate only exists in the `serve --all` startup loop (`serve.ts` `startChannel`),
  while every pairing/attach path calls `session.setPermissionResolver`
  UNCONDITIONALLY (`start-registered-channel.ts` both attach modes, each channel's
  `pair-flow.ts`, mobile `single-session-host.ts`) — so in practice the resolver is
  last-writer-wins: pair Discord then WhatsApp and Discord silently stops receiving
  permission prompts (they route to the most recent channel's surface). One Session
  has exactly one resolver slot (`core/src/session.ts setPermissionResolver`).
  `moxxy onboard` sidesteps it (single channel pick, pair-then-return), but a real
  fix needs either per-source resolver routing on the Session or a documented
  broker. Surfaced 2026-07-03 while building onboard.

## Mobile UI (low-priority polish)

- [med] Sending attachments while a turn is in flight is refused (inline payloads
  can't ride the path-based queue) — queue host-side if needed. `apps/mobile/`.
- [low] Misc (remaining after 2026-07-05 cleanup): `selectWorkspace`/`activeWorkspaceId`
  misnamed (they select a session) — BLOCKED, it's a shared
  `client-core`/`desktop-ipc-contract` wire symbol, not mobile-local; `expo-blur` is a hard
  dep but `BlurView` is actually used (not removable — revisit only if the glass surface is
  dropped); theme flip could be reworked to a `themeVersion`-in-memo-deps model (today an
  existing `key={scheme}` FlatList remount already re-resolves rows, so low value); header
  rename low-discoverability; composer-minimize overlay gesture not wired. (SafeAreaView
  migration, `toolGroupUi` dead fields, and the unused `LargeHeader` are FIXED — see ledger.)
- [note] EAS build: `eas-build-post-install` runs `pnpm build` on the workspace
  closure; local repro needs wiping both `dist/` AND `*.tsbuildinfo`. `apps/mobile/eas.json`.

## Brand & design tokens

- [low, logged 2026-07-28] `gradient.user` / `--grad-user` is now a dead token:
  the user turn dropped the gradient bubble (#492) and then moved to an accent
  rule, so nothing reads it. It is still declared in `packages/design-tokens/src/index.ts`
  (plus the override tables in `css-vars.ts` and its test) and mirrored in
  `apps/desktop/src/styles.css` (x2) and `apps/desktop/src/focus/focus-styles.ts`
  (x3, still carrying the pre-#478 pink hexes). Retiring it means deleting the
  leaf and all six mirrors together, since the parity test holds them in lockstep.
- [med, logged 2026-07-27, refreshed 2026-07-28] The mark and the product palette
  disagree. The logo ships Signal `#FF4A1E` (`assets/brand/`), while
  `packages/design-tokens` exports a muted blue `#2f5d8f` as `primary` (it was
  pink `#ec4899` when this was logged; #478 retoned it, but not toward the mark),
  so every accent in desktop and mobile reads blue around an orange mark — most visibly the primary-tinted
  disc the mark sits inside on mobile onboarding and the empty chat state.
  Retiring this means repalletting the token set (`packages/design-tokens/src/index.ts`
  plus the mirrored literals in `apps/desktop/src/styles.css`, which the parity
  test keeps in lockstep). Deliberately scoped out of the logo change: recolouring
  every accent is a product decision, not a logo swap.

## Docs site

- [note, logged 2026-07-03] `apps/docs/src/content/docs/why-moxxy.md` carries
  dated competitor claims (star counts, channel counts, security-posture quotes
  from OpenClaw/pi/Hermes READMEs, "as of July 2026"). These go stale; re-verify
  against the linked sources roughly quarterly or when a comparison looks off.

## Memory & embeddings

- [med] plugin-memory `EmbeddingIndex` stays separate from the SDK
  `CachedEmbeddingProvider` (different keying/bounding/persistence/eviction) — leave
  as-is; revisit only if `EmbeddingIndex` is reworked anyway. `packages/plugin-memory/`.
