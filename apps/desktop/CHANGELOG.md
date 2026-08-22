# @moxxy/desktop

## 0.39.0

### Minor Changes

- 971fd32: Browser: accessibility-first perception, named tabs, and a much cheaper live view.

  The agent now reads pages as an accessibility tree where every interactive
  element carries a `[uid]` it can act on, instead of choosing between a wall of
  `innerText` and a screenshot — neither of which it could click, which is why it
  had to guess CSS selectors. New tools: `browser_snapshot`, `browser_click`,
  `browser_type`, `browser_navigate`, `browser_tabs`. `browser_session` remains
  as the escape hatch for CSS selectors and in-page `eval`.

  Every snapshot carries the open-tab list (so the agent never has to ask which
  page it is on), frames page content as untrusted data, and redacts
  credential-shaped field values before they reach the model.

  Acting on a `uid` from before a navigation now fails with a clear "take a fresh
  snapshot" rather than clicking whatever occupies that position now.

  The live preview no longer streams while nobody is watching, skips frames
  identical to the last one, and renders at CSS scale rather than 2x — the same
  view at roughly a quarter of the pixels.

  Desktop: the browser pane now hosts pages in real Chromium views the window
  composites (Electron `<webview>`s main hardens at attach time), instead of
  receiving a JPEG several times a second. Tabs stay mounted so a background page
  keeps its state, and the agent drives those same views over CDP through a
  private, token-authenticated socket — so the human and the agent look at one
  document, which is what makes watching the agent work, and taking over from it,
  possible at all. Outside the desktop (CLI, headless, a remote runner) the tools
  fall back to the Playwright sidecar unchanged.

  `browser_capture` restores region capture on top of CDP: pass a uid and it crops
  to that element rather than shipping a whole viewport.

  The agent can now stop and hand the browser to you. `browser_await_human` puts a
  banner on the pane saying what it needs — a sign-in, a one-time code, a consent
  screen — and blocks until you click Done or Skip. While it is pending the agent
  is not reading the page, so nothing you type during a hand-off is snapshotted,
  logged, or sent to the model, and every uid from before the pause is invalidated
  afterwards. Tab changes the agent makes are pushed to the pane, so the tab strip
  can no longer disagree with the page in front of you. `browser_history` gives
  back/forward/reload the same treatment.

- 16b0fe3: Reading a page costs what changed, and a sequence of actions costs one read.

  The whole accessibility tree on every read is what a heavy page cost: ~25,300
  tokens for a Wikipedia article, ~9,700 for Canva's home page, almost all of it
  identical to the read before because the agent had clicked one thing. One Canva
  task came to 2.2 million tokens, nearly all of it re-sending a page that had
  barely moved.

  Two things were in the way, and both are now gone.

  **uids meant a position, so nothing could be called unchanged.** They were handed
  out by a counter in document order, so inserting one element renumbered
  everything below it — measured on a Wikipedia article, one added element left 1%
  of the rendered lines matching. Chromium's own accessibility node ids do not
  move: after that same insertion, all 17,644 nodes carrying a DOM node kept
  theirs and none changed. uids are now short labels minted against those and
  remembered for the life of the document, so a uid means the same element read
  after read. They survive the tree being handed back for being idle — measured
  too: after `Accessibility.disable`, a detach and a re-attach, 1,636 nodes kept
  their ids — and they are dropped when the page actually navigates, including a
  navigation the person started by clicking a link.

  **Every read sent the whole page.** After the first read of a tab, a read now
  carries only what was removed, added or changed, keyed by uid so a row that
  merely shifted down is not reported as a change. The comparison runs over the
  rendered text, so it is exactly what would have been sent, with no second
  implementation of the pruning rules to drift. `full: true` asks for the whole
  tree when the changes alone are not enough. Measured: a Wikipedia article after
  one element appears, 25,345 tokens down to 1,136.

  **And `browser_batch`**, because the other half of the cost is one read per
  action. It runs a sequence — click, type, press, navigate, go back — and reads
  the page once at the end. Steps stop at the first failure and the error names
  which step it was, so a sequence never carries on against a page that did not do
  what was expected. One approval covers the whole thing and shows every step,
  which is more informative than four prompts answered in a row.

  Measured end to end: opening Canva and creating an Instagram post project went
  from about 1.4 million tokens to 501 thousand.

- 87e3e10: The agent can press keys, and the browser skill knows about the tools it has.

  There was no way to send a key at all. An agent that needed Cmd+A to replace what
  a field already held had nothing to reach for — and, watched live on Canva, it
  went looking for a different browser rather than report that it could not press a
  key. `browser_key` closes that: `Enter` to submit, `Escape` to dismiss, `Tab` to
  move on, `Meta+a` then `Backspace` to empty a field. Modifiers combine with `+`.
  The sidecar backend has had this since the beginning; only the desktop was
  missing it, so a task's outcome depended on where it ran.

  `Input.insertText` looked like the shorter road for a single character and is not
  one: on its own, after the click that focused the field, it does nothing at all.
  A key event carrying its `text` is what actually types, which is what this sends.

  Getting a key to land took two more things, both found by watching it fail in the
  app rather than in a test. A key only reaches the page when the `<webview>`
  ELEMENT has focus in the window's DOM — and answering the approval prompt takes
  that away, because answering means clicking in the app. `webContents.focus()`
  from main does not fix it: the guest is a child of the embedder, so main now asks
  the pane to focus the element and waits for it to say it has. And a hidden view
  cannot take focus at all, so the pane brings the agent's tab forward first —
  which is the honest thing anyway, since the agent is about to act there and this
  browser exists so the user can watch that happen.

  The cost is one deliberate side effect: pressing a key moves keyboard focus off
  the composer and brings the agent's tab to the front. There is no way around it —
  Chromium will not deliver a key to a page that is hidden and unfocused — so it is
  scoped to `browser_key` alone. Reading and clicking leave focus where it is, and
  a test says so.

  The browser skill had drifted badly. It still described driving pages by CSS
  selector and its `allowed-tools` listed only `browser_session`, so an agent that
  loaded it was told to use none of the perception tools built since. It now
  describes reading a page as an accessibility tree, acting by uid, and handing
  over when a page needs a person — with `browser_session` named as the escape
  hatch below that, which is where it belongs.

  Nothing failed while the skill was stale, which is the point: a skill naming a
  tool that does not exist is silently dropped, and one omitting a tool that does
  exist just quietly withholds it. Two tests now tie the skill's `allowed-tools` to
  what the plugin actually ships, in both directions.

  Known limit, found and not yet chased: on canva.com the agent correctly stops at
  the cookie banner and hands over, but the banner is pinned to the bottom of the
  page viewport and that sits below the visible edge of the pane — so the person
  has nothing to click and the hand-off repeats. Whether the `<webview>` is taller
  than its container or the window was simply too short is unmeasured. Any page
  with something fixed to the bottom is affected, not just Canva.

- 971fd32: Browser pane: a tab strip you can actually close tabs in, and chrome that
  belongs to the rest of the app.

  There was no way to close a tab. There is now one per tab — quiet until you
  hover or tab onto it, so the strip is not a row of × marks, and never able to
  leave you with zero tabs: closing the last one opens a fresh home tab rather
  than an empty rectangle with an address bar.

  The chrome was inline styles that happened to work; it is now built from the
  same tokens and the same grammar as the workbench tabs above it. The tab row is
  recessed and the active tab is lifted onto the toolbar's surface and merged with
  it, the way a browser tab has always joined its toolbar — no second accent
  underline a few pixels below the workbench's own, which is what made the two
  rows compete. New-tab sits against the last tab instead of marooned at the far
  edge, and stays reachable when the strip scrolls.

  The toolbar's last button now takes a picture of the page and hands it to the
  agent, arriving in the composer as an ordinary attachment chip named after the
  site (`browser-canva.com.png`) — the same journey a pasted screenshot makes, so
  it rides the same provenance and send pipeline rather than a second one. It
  replaces a panel that dumped the accessibility tree the agent reads. How the
  agent perceives a page is between the agent and the host; showing it to the
  person was a debugging aid, not a feature, and `browser.snapshot` is gone from
  the renderer's IPC surface with it.

  The strip also stops lying. It was pushed only when a tab was added, removed or
  selected, so a page that retitled or navigated itself left the strip naming
  something that was no longer on screen — two tabs both labelled "DuckDuckGo"
  while the second was showing example.com. Main now watches each adopted view
  and pushes on title and navigation changes as well.

- 396319f: The browser searches with Google, and says when a page has stopped being
  readable and started asking for a person.

  Some pages are not pages any more: a cookie banner, a CAPTCHA, a sign-in form.
  The agent must not clear any of them — the consent belongs to the user, the
  CAPTCHA is theirs to solve, the password is theirs to type — and an agent that
  presses "Accept all" on someone's behalf has made a decision nobody asked it to
  make. Every acting tool is already permission-gated, so this is not the only
  guard; it is the one that arrives before the model has to work out what it is
  looking at from a pile of buttons. The snapshot now carries a `### Needs you`
  section naming the wall and telling the agent to call `browser_await_human`
  instead of clicking through it.

  Detection reads the accessibility tree, not the prose: the words have to sit on
  something pressable, so an article about cookies is still an article. Where a
  page is several walls at once, the most blocking one is named — a sign-in behind
  a CAPTCHA needs the CAPTCHA cleared first. The credential vocabulary is now
  shared with the redactor rather than copied, because a security regex with two
  copies is a security regex with two behaviours.

  A new tab and a typed phrase now go to Google rather than DuckDuckGo. On a
  profile that has never been there Google answers with the EU consent wall, which
  is exactly the case above: the agent hands over, the user answers once, and the
  persistent partition remembers it.

### Patch Changes

- f001db6: Opening a tab goes to it, the way every browser does.

  A new tab appeared in the strip and the pane stayed on the old one, so pressing
  plus looked like nothing had happened and a tab the agent opened was somewhere
  you had to go find.

  A view is registered exactly when someone opened a tab — the person pressed plus,
  or the agent asked for one — so that is the moment to move to it. It moves what
  the person sees and nothing else: where the agent is working is tracked apart
  from the tab in front, which is the same separation that stops a click in the
  strip from re-aiming the agent mid-task.

- 971fd32: The agent's browser tools all drive the page you are looking at.

  `browser_session` built its own call bound straight to the Playwright child,
  skipping the backend switch every other browser tool goes through. Inside the
  desktop that launched a SECOND Chromium — none of the signed-in profile,
  invisible to everyone — and the agent worked in that one while the person
  watched the real page sit still. Asked to play a YouTube video, the agent
  reported that it had, and was telling the truth about a browser nobody could
  see. It now routes through the same switch as the rest of the plugin, and the
  Playwright child is only reached for when it is the backend answering.

  The desktop bridge grew the verbs that switch then delivers: `click` and `fill`
  by CSS selector, `text`, `html`, `eval` and `screenshot`. Selector lookup
  retries while the page settles rather than failing on the first miss, and `fill`
  selects what a field already held so the insert replaces instead of appending —
  by selection, not by assigning `.value`, which is the only form a
  framework-controlled input sees. The sidecar's `close` is a no-op here: that
  browser is the user's, on screen, holding their logins.

  The pane's active tab and the tab the agent is working on are now separate. They
  were the same value, so a person clicking a tab mid-task silently re-aimed the
  agent's next un-targeted command at the page they had just opened. The agent's
  aim moves only when the agent names a tab or opens one, and is forgotten when
  that tab closes.

- 94ff81b: A page only counts as waiting on a person when there is something real to press —
  and the person is shown it before they are asked.

  The wall detector reads the accessibility tree, which is enough to spot a
  consent button or a password field and not enough to know either is drawn. A
  control can sit in the tree without being on screen — hidden by opacity, moved
  away by a transform, inside a collapsed container, or simply left behind after
  the banner it belonged to was dismissed. Reported as a wall, one of those traps
  the agent in a hand-off nobody can answer: the person is told to press something
  they cannot see, presses Done because there is nothing to do, and the next read
  says exactly the same thing.

  Seen live on canva.com, where the agent asked three times running for a cookie
  choice the user could not find. The banner had been real earlier in the session
  and was gone by the time they looked.

  `detectWall` now names the node it matched, and the callers — which do have
  geometry — check something is actually laid out for it before believing it. Both
  backends do this: the desktop through `DOM.getBoxModel`, the sidecar through the
  point lookup it already uses to decide whether a uid can be clicked.
  `formatSnapshot` no longer decides for itself; it renders what it is told,
  because telling a wall from a control that merely exists needs more than the tree
  it is given.

  A box is layout, not visibility — an element far down the page has a perfectly
  good one — and that is on purpose: a consent banner below the fold is still a
  real wall. Being _shown_ it is a separate job, and it belongs to the hand-off.
  Raising one now brings its tab to the front, scrolls to the control, and asks the
  page whether the element actually landed in view. When it did not, the banner
  says so and tells the person to go looking, rather than asking them to press
  something that is not on their screen — which is precisely how a hand-off turns
  into a loop: press Done, nothing changed, asked again.

  Also settled while chasing this: the pane's `<webview>` is not taller than its
  container. A capture of the guest viewport matches what the pane shows — so the
  suspicion recorded in the previous commit was wrong, and pages with something
  fixed to the bottom are fine.

  The pattern that decides what a consent control looks like was too loose. It
  matched bare stems — `akceptuj`, `więcej opcji` — and Canva's account menu is
  called "Więcej opcji konta i zespołu", so every snapshot of a logged-in Canva
  reported a consent wall that was not there. The agent, trusting the section,
  asked the user to answer a cookie banner that did not exist; pressing Done
  changed nothing, so it asked again. Three times, over an hour, before the
  hand-off banner started naming the control it had found — at which point the
  account menu identified itself in one screenshot.

  A control now counts as consent if its label mentions cookies, or uses a phrase
  that appears nowhere but a consent banner. Over-matching here is not a small
  cost: it sends the person looking for something that is not there.

  The hand-off banner names the control from now on. It is the difference between
  "I cannot see it" and "I am looking at the wrong thing", and it turned an hour of
  guessing into one screenshot.

- 971fd32: Tool parameter descriptions now reach the model.

  `zodToJsonSchema` dropped every `.describe()` on the floor, so a field
  documented as "omit for the active tab" arrived at the provider as a bare
  `{"type":"string"}`. The model had nothing to go on and invented values —
  observed live as `tab_id: "current"` against a browser that names its tabs
  `t1`, `t2`. Descriptions are now carried through to the JSON schema, including
  from under `.optional()`, `.default()` and `.refine()` wrappers; where a wrapper
  and the type it wraps both carry one, the outermost wins.

  This affects every tool in every plugin: any `.describe()` written against a
  field is now text the model actually reads. Nothing else about the emitted
  schema changes.

  Desktop: readiness-waits for a workspace runner shared one pool subscription
  instead of attaching one listener each. A dozen workspaces used to push the
  runner pool past Node's default listener cap and print a
  MaxListenersExceededWarning on every launch, which then hid any genuine
  listener leak behind known noise.

- Updated dependencies [971fd32]
- Updated dependencies [16b0fe3]
- Updated dependencies [87e3e10]
- Updated dependencies [971fd32]
- Updated dependencies [94ff81b]
- Updated dependencies [396319f]
- Updated dependencies [971fd32]
  - @moxxy/cli@0.38.0
  - @moxxy/sdk@0.38.0
  - @moxxy/chat-model@0.4.7
  - @moxxy/client-core@0.13.25
  - @moxxy/client-platform-web@0.1.64
  - @moxxy/desktop-host@0.14.16
  - @moxxy/desktop-ipc-contract@0.14.21
  - @moxxy/ipc-server-ws@0.1.63
  - @moxxy/plugin-channel-mobile@0.38.0
  - @moxxy/plugin-stt-whisper-codex@0.38.0
  - @moxxy/plugin-vault@0.38.0
  - @moxxy/runner@0.2.50
  - @moxxy/workflows-builder@0.1.47

## 0.38.0

### Minor Changes

- 9e26bd8: Voice Mode no longer replaces the conversation. Starting one now adds a 58px presence rail between the ask sheet and the composer, and leaves the header, the full transcript and the text composer exactly where they were — so a voice conversation is the same conversation with a microphone open: you can scroll back, search, open a tool result, and type. A message sent from the composer during a call runs as an ordinary turn and its answer is read back.

  The rail carries the shared `MoxxyMark` between two fans of radio arcs that travel outward only while a voice is actually carrying, hairline-separated sections, and one operation at a time — the oldest still running, held in place while newer tools come and go, with the rest counted as `+N active` and a quiet "No tools running" holding the slot's shape when there is nothing to report. Microphone, waiting sound and ending the call stay reachable throughout, as do the Local Piper install prompt and the retry after a failure. The mark breathes with the voice through a single CSS custom property driving a scale and an opacity, so the animation is composited rather than painted and there is no canvas in the main window at all.

  The full-screen surface it replaces is deleted, along with its particle hologram, sprite cache and orbit. Focus Mode is untouched.

- 9757ae4: Move the commanded accent from magenta to the brand's Signal orange, so the app
  accents on the same hue as the mark, the site and the rest of the branding
  (`assets/brand/README.md`). Everything the accent touches follows: the send
  action, the human's turn in the trace, the active rail item, focus rings, the
  sidebar's active wash, filled buttons, the terminal cursor, and the second
  strand of the mark on both pre-React splash screens.

  On ink the accent is Signal exactly — `#FF4A1E` clears every contrast gate on a
  dark ground. On paper it cannot be: `#FF4A1E` carries a white label at only
  3.36:1 and sits at 2.78:1 against the panel ground, under the 4.5 and 3.0 floors
  the palette is held to. Light therefore uses Signal's hue at full saturation,
  deepened to the stop where white clears 4.5:1. That asymmetry is not new — it is
  the rule the palette already documented for magenta, now carried over: the paper
  accent is deep and white-labelled, the ink accent is luminous and ink-labelled.

  The semantic hues are untouched. `green`, `amber`, `red` and `reference` still
  mean nominal, attention, failure and reference data, and still carry their own
  contrast floors.

### Patch Changes

- 0546070: Tighten the Focus Mode action bar by integrating its controls directly beside the Moxxy mark.
- baa584b: Make Mini Chat compact, cancellable, and functionally consistent with the main transcript.
- 3fcde74: Draw Focus Mode with the same in-app Moxxy mark the rest of the window uses. The floating widget rendered a raster mascot, the mini-text header scaled down the packaged app icon, and the pre-mount boot tile rendered a typed `m` glyph in a colour outside the palette. All three now render `MoxxyMark`, so the floating widget and the main window cannot drift apart. The app icon at `public/logo.png` is unchanged and stays the product's icon.
- 06d247c: Show a stop control while Focus Mode is dictating. The microphone button kept
  drawing a microphone once capture was live, so a control that would END the
  recording looked exactly like one that would start it, and the only hint that a
  second press was needed lived in the accessible name. It now switches to the
  stop glyph and reads as pressed for as long as it is listening, matching the
  voice mode button beside it. The transcribing state keeps its own indicator.
- e812ebe: Make Mini Chat Voice Mode statuses speak in the first person, surface queued messages with removable chips, and expose a stop control for the current task.
- 861548a: Mirror Voice Mode follow-ups queued in the main renderer into Focus Mini Chat so they stay visible and removable before execution.
- 1bbbbaf: Polish Focus Mode voice feedback with shared radio waves, a full-width Signal-orange visualizer, a clockwise corner loader, and a visible Mini Chat listening state.
- f4126b0: Keep generating and displaying the complete assistant response when the user speaks over Voice Mode. Barge-in now stops only Piper playback, preserves live tool activity, and queues the transcribed follow-up for the next turn; explicit Stop remains the hard-abort action.
- 9efe2ea: Two fixes underneath Voice Mode, both found by profiling the running app rather than a harness.

  **Markdown re-parsing.** Rendered Markdown re-parses in full on every render, and a streaming turn re-renders the transcript on every delta, so every visible message in the conversation was re-parsing on every delta. `MarkdownBody` is now memoised and the parse sits behind its own memo boundary, so an unchanged message costs nothing. The message that IS growing is re-parsed on an interval derived from how long its previous parse actually took, which holds parsing at about a fifth of the renderer whatever the answer's length or structure.

  **Audio.** Piper streams a sentence at a time and each clip built and closed its own `AudioContext`, tearing the audio device down and reopening it between every sentence. One context is now kept warm for the session, released and rebuilt when the output device changes — detached rather than closed, so the sentence playing right now finishes on the device it started on. Closing the context per clip had also been what released the clip's `<audio>` element; that is now explicit on every finish path, so a long conversation no longer leaves a decoded sentence per element waiting on the collector.

- 62042eb: Reconcile chat and Focus activity with live foreground turns after runner restarts.
- 48d0292: Keep Voice Mode status, active work and controls visible in narrow desktop chat layouts.
- aaaaf02: Restore active task status when Focus Mode joins a turn already running in the main chat.
- Updated dependencies [e18e120]
- Updated dependencies [84dd2c5]
- Updated dependencies [9efe2ea]
- Updated dependencies [62042eb]
- Updated dependencies [9757ae4]
  - @moxxy/cli@0.37.2
  - @moxxy/sdk@0.37.2
  - @moxxy/client-platform-web@0.1.63
  - @moxxy/design-tokens@0.5.0
  - @moxxy/desktop-ui@0.3.1
  - @moxxy/chat-model@0.4.6
  - @moxxy/client-core@0.13.24
  - @moxxy/desktop-host@0.14.15
  - @moxxy/desktop-ipc-contract@0.14.20
  - @moxxy/ipc-server-ws@0.1.62
  - @moxxy/plugin-channel-mobile@0.37.2
  - @moxxy/plugin-stt-whisper-codex@0.37.2
  - @moxxy/plugin-vault@0.37.2
  - @moxxy/runner@0.2.49
  - @moxxy/workflows-builder@0.1.46

## 0.37.1

### Patch Changes

- 4d89d64: Harden temporary files and remove filesystem race windows from runtime reads.
- e80b9d6: Replace vulnerable regular-expression parsers with bounded linear-time input scanners.
- 5e4ca9f: Patch vulnerable dependencies, enable continuous security scanning, and harden Metro image parsing.
- Updated dependencies [4d89d64]
- Updated dependencies [945202d]
- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/cli@0.37.1
  - @moxxy/sdk@0.37.1
  - @moxxy/chat-model@0.4.5
  - @moxxy/client-core@0.13.23
  - @moxxy/client-platform-web@0.1.62
  - @moxxy/desktop-host@0.14.14
  - @moxxy/desktop-ipc-contract@0.14.19
  - @moxxy/ipc-server-ws@0.1.61
  - @moxxy/plugin-channel-mobile@0.37.1
  - @moxxy/plugin-stt-whisper-codex@0.37.1
  - @moxxy/plugin-vault@0.37.1
  - @moxxy/runner@0.2.48
  - @moxxy/workflows-builder@0.1.45

## 0.37.0

### Minor Changes

- 78938f8: Introduce the developer-alpha product contract and personal golden path, redesign the TUI around a one-time workspace welcome, contextual work status, consequence-first approvals, responsive Runs, Models, and product-facing Extensions, progressively disclose CLI and TUI commands by capability, auto-allow real-path-safe reads inside the workspace, and add bounded data-only client chrome slots for extensions.

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/cli@0.37.0
  - @moxxy/sdk@0.37.0
  - @moxxy/chat-model@0.4.4
  - @moxxy/client-core@0.13.22
  - @moxxy/client-platform-web@0.1.61
  - @moxxy/desktop-host@0.14.13
  - @moxxy/desktop-ipc-contract@0.14.18
  - @moxxy/ipc-server-ws@0.1.60
  - @moxxy/plugin-channel-mobile@0.37.0
  - @moxxy/plugin-stt-whisper-codex@0.37.0
  - @moxxy/plugin-vault@0.37.0
  - @moxxy/runner@0.2.47
  - @moxxy/workflows-builder@0.1.44

## 0.36.1

### Patch Changes

- Updated dependencies [9d343c0]
  - @moxxy/cli@0.36.1
  - @moxxy/runner@0.2.46
  - @moxxy/desktop-host@0.14.12
  - @moxxy/ipc-server-ws@0.1.59
  - @moxxy/plugin-channel-mobile@0.36.1
  - @moxxy/sdk@0.36.1
  - @moxxy/plugin-stt-whisper-codex@0.36.1
  - @moxxy/plugin-vault@0.36.1
  - @moxxy/chat-model@0.4.3
  - @moxxy/client-core@0.13.21
  - @moxxy/client-platform-web@0.1.60
  - @moxxy/desktop-ipc-contract@0.14.17
  - @moxxy/workflows-builder@0.1.43

## 0.36.0

### Minor Changes

- bc7844e: Bound a session's context by policy instead of by how long it has been running, and give the desktop a real keymap.

  A new default compactor (`segments`) records every finished turn as one dense sub-session record (Asked / Did / Outcome / Facts / Open) that replaces the turn's raw events in context. Once the index of records passes its cap the oldest fold into a chapter, so the index is bounded too. Nothing is lost: the event log keeps every original event, the new `session_recall` tool searches the records, and `recall({ turnId })` restores one sub-session verbatim. `summarize-old-turns` stays registered as the protected floor and is selectable via `plugins.compactor.default`.

  SDK: compaction ranges now supersede any earlier range they fully contain (`activeCompactionRanges`), which is what lets a compactor re-compact its own summaries; projection and the token estimate share that one decision. `summarizeWithProvider` is extracted so compactors don't each re-implement the summarize-or-degrade-but-never-on-abort contract.

  Desktop: one registry-backed keymap with a single window dispatcher: ⌘K palette, ⌘L composer, ⌘F search, ⌘. interrupt, ⌘N session, ⌘⌥↑/↓ session switching, ⌘B sidebar, ⌘J workbench, ⌘1-5 destinations, ⌘, settings, ⌘/ for the shortcut sheet, which renders from the live registry so it cannot drift from what is bound.

  Also fixes a pre-existing name drift: the CLI's compactor floor and built-in default referred to `summarize`, but the def is named `summarize-old-turns`, so neither ever matched.

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/cli@0.36.0
  - @moxxy/sdk@0.36.0
  - @moxxy/chat-model@0.4.2
  - @moxxy/client-core@0.13.20
  - @moxxy/client-platform-web@0.1.59
  - @moxxy/desktop-host@0.14.11
  - @moxxy/desktop-ipc-contract@0.14.16
  - @moxxy/ipc-server-ws@0.1.58
  - @moxxy/plugin-channel-mobile@0.36.0
  - @moxxy/plugin-stt-whisper-codex@0.36.0
  - @moxxy/plugin-vault@0.36.0
  - @moxxy/runner@0.2.45
  - @moxxy/workflows-builder@0.1.42

## 0.35.0

### Minor Changes

- f67df0b: Open persisted chats before runners connect, reconcile live history in the background, make onboarding completion and optional provider recovery skippable without blocking IPC, isolate runner sockets per profile, separate workspace groups with colour chips and nested guide rails, align staged attachments, unify compact Voice Mode controls and filled-button contrast, make dialogs viewport-safe with a responsive model picker, refine the MoxxyAI wordmark, repair Local Piper installs affected by transient plugin-seed manifests, and add language-aware file/diff highlighting with richer Markdown, Office, PDF, audio, and video previews.

## 0.34.1

### Patch Changes

- Updated dependencies [051f405]
  - @moxxy/cli@0.35.4
  - @moxxy/sdk@0.35.4
  - @moxxy/plugin-channel-mobile@0.35.4
  - @moxxy/plugin-stt-whisper-codex@0.35.4
  - @moxxy/plugin-vault@0.35.4
  - @moxxy/chat-model@0.4.1
  - @moxxy/client-core@0.13.19
  - @moxxy/client-platform-web@0.1.58
  - @moxxy/desktop-host@0.14.10
  - @moxxy/desktop-ipc-contract@0.14.15
  - @moxxy/ipc-server-ws@0.1.57
  - @moxxy/runner@0.2.44
  - @moxxy/workflows-builder@0.1.41

## 0.34.0

### Minor Changes

- c49ab14: Redesign the desktop around one navigation rail, an instrument bar and a trace.

  The app had its navigation split across two organs — a segmented pill in the
  main-pane header and a list at the foot of the sidebar — so the same kind of
  decision lived in two places and the header never said where you were. It now has
  one 52px app rail, a contextual index column beside it, a field with an instrument
  bar that identifies the run and carries its telemetry, and a tabbed workbench.

  - **Tokens.** A new palette (achromatic panel greys, colour only on data, one
    accent that means "the human commanded this"), a mono chrome face with a
    proportional face for prose, and the scales the package never had: spacing,
    type, frame heights, motion. Gradients are gone.
  - **Telemetry** (context window, token count, model, mode) moves out of chips
    inside the composer and into permanent chrome, where the numbers that make you
    intervene in an unattended run belong.
  - **The transcript becomes a trace**: every entry hangs off one timeline in a
    fixed gutter, tool calls group into numbered steps with measured durations, and
    a blocking approval docks above the command bar instead of floating over the
    scroll.
  - **Automations and Channels become destinations.** Workflows, schedules and
    webhooks left the Apps grab-bag; Mobile became one channel among the rest.

  Also fixes, found while building it: the focus window's dark palette had drifted
  in one of its three hand-maintained copies, so a system-dark user with no stored
  theme preference got the light accent on a dark panel; and the renderer fetched
  its webfonts from a CDN, which meant a cold offline boot rendered in a silent
  fallback face. Both are gone, and with them the two CSP allowances the font CDN
  needed.

### Patch Changes

- Updated dependencies [c49ab14]
  - @moxxy/design-tokens@0.4.0
  - @moxxy/desktop-ui@0.3.0
  - @moxxy/chat-model@0.4.0
  - @moxxy/desktop-host@0.14.9
  - @moxxy/client-core@0.13.18
  - @moxxy/client-platform-web@0.1.57
  - @moxxy/cli@0.35.3
  - @moxxy/sdk@0.35.3
  - @moxxy/plugin-channel-mobile@0.35.3
  - @moxxy/plugin-stt-whisper-codex@0.35.3
  - @moxxy/plugin-vault@0.35.3
  - @moxxy/desktop-ipc-contract@0.14.14
  - @moxxy/ipc-server-ws@0.1.56
  - @moxxy/runner@0.2.43
  - @moxxy/workflows-builder@0.1.40

## 0.33.2

### Patch Changes

- @moxxy/plugin-stt-whisper-codex@0.35.2
- @moxxy/desktop-host@0.14.8
- @moxxy/cli@0.35.2
- @moxxy/sdk@0.35.2
- @moxxy/plugin-channel-mobile@0.35.2
- @moxxy/plugin-vault@0.35.2
- @moxxy/chat-model@0.3.28
- @moxxy/client-core@0.13.17
- @moxxy/client-platform-web@0.1.56
- @moxxy/desktop-ipc-contract@0.14.13
- @moxxy/ipc-server-ws@0.1.55
- @moxxy/runner@0.2.42
- @moxxy/workflows-builder@0.1.39

## 0.33.1

### Patch Changes

- @moxxy/plugin-stt-whisper-codex@0.35.1
- @moxxy/desktop-host@0.14.7
- @moxxy/cli@0.35.1
- @moxxy/sdk@0.35.1
- @moxxy/plugin-channel-mobile@0.35.1
- @moxxy/plugin-vault@0.35.1
- @moxxy/chat-model@0.3.27
- @moxxy/client-core@0.13.16
- @moxxy/client-platform-web@0.1.55
- @moxxy/desktop-ipc-contract@0.14.12
- @moxxy/ipc-server-ws@0.1.54
- @moxxy/runner@0.2.41
- @moxxy/workflows-builder@0.1.38

## 0.33.0

### Minor Changes

- 5164d4b: Retune the desktop and mobile palette to the woven brand.

  The muted blue the palette landed on carries nothing of the mark: the brand is
  Ink (`#0B0D12`) plus Signal (`#FF4A1E`) on paper, so every accent in the app
  read cool around a warm mark.

  `@moxxy/design-tokens` is the source of truth for the desktop CSS variables and
  the mobile Tailwind config, so the change lands in one place and reaches every
  component that reads a variable. Signal becomes the primary, send and focus
  colour; the secondary moves into Signal's family; the canvas goes neutral so
  nothing fights Signal's warmth; and the text ramp becomes Ink.

  Interactive fills take Signal's DEEP stop (`#C4310F`), not the flat mark
  colour: white on flat Signal is 3.36:1, and a CTA label is the one place that
  cannot be borderline. Flat Signal lives on as the mark, the focus ring and the
  soft washes. On dark it lifts again, to `#FF6A44`, for the same reason the mark
  ships a `-dark` variant rather than being recoloured by CSS. The contrast suite
  covers both themes.

  Categorical and semantic hues are deliberately left alone. A workflow step kind
  is identified by its hue and green/amber/red mean success/attention/error, so
  collapsing them into the brand's single accent would destroy information. Only
  the fallback moves to Signal.

  Headings now take Space Grotesk, echoing the wordmark's geometric
  construction. It joins the Google Fonts request Inter already makes, and the
  stack falls back to Inter, so an offline launch looks exactly as it does today.

  Also swept: the standalone focus window carried a second copy of the palette,
  and a handful of components had the old hexes inline, including the pink glows
  and plan badges the previous retone left behind. The voice spectrogram keeps
  its blue-violet-pink ramp: that is a data gradient, not a brand accent.

- 34cca59: Chat: a user turn now reads left-to-right like every other block, with an
  avatar, a "You" label and an accent left rule instead of right-aligned text.
  Right alignment only said whose turn it was while the turn was short: a pasted
  prompt wrapped into a ragged-left column the eye had to re-find on every line.

  Tray: the macOS menu bar gets the one-colour mark as a template image at 22px
  and @2x, so AppKit tints it for the light and dark bar and for the menu-open
  state. Windows and Linux keep the colour icon, since their tray chrome is not
  ours to tint against.

### Patch Changes

- Updated dependencies [5164d4b]
- Updated dependencies [34cca59]
  - @moxxy/design-tokens@0.3.0
  - @moxxy/desktop-ui@0.2.0

## 0.32.1

### Patch Changes

- ca8a468: Fix the blank desktop window, and drop the chat bubble for plain text.

  **Blank window.** The packaged app serves its renderer from a loopback HTTPS server at `https://desktop.moxxy.ai:<port>`, because a Clerk production key rejects any Origin that is not a `moxxy.ai` host. Resolving that name was left to a public DNS A-record pointing at 127.0.0.1, so every installed copy depended on one record staying alive. It stopped resolving, and every app opened to an empty window with only `ERR_NAME_NOT_RESOLVED` in a log nobody reads.

  Chromium now maps that one hostname to loopback itself, set in the bootstrap prologue (before the network stack initialises, and inside the immutable floor so a bad hot-update cannot remove the rule the app needs to load its own UI). The app no longer needs DNS to start, which also means it opens offline, on a filtered corporate resolver, and cannot be pointed elsewhere by whoever controls the zone. A test keeps the duplicated hostname literal in step with `DESKTOP_APP_HOST`.

  **Chat bubble.** A user prompt rendered as a gradient-filled rounded bubble with white ink, a text-shadow and a drop shadow, all to keep one short line readable against itself. Right alignment already says whose turn it is, so it is now just text.

- Updated dependencies [57f0810]
- Updated dependencies [148812c]
  - @moxxy/sdk@0.35.0
  - @moxxy/cli@0.35.0
  - @moxxy/chat-model@0.3.26
  - @moxxy/client-core@0.13.15
  - @moxxy/client-platform-web@0.1.54
  - @moxxy/desktop-host@0.14.6
  - @moxxy/desktop-ipc-contract@0.14.11
  - @moxxy/ipc-server-ws@0.1.53
  - @moxxy/plugin-channel-mobile@0.35.0
  - @moxxy/plugin-stt-whisper-codex@0.35.0
  - @moxxy/plugin-vault@0.35.0
  - @moxxy/runner@0.2.40
  - @moxxy/workflows-builder@0.1.37

## 0.32.0

### Minor Changes

- f57796b: New logo: two rounded squares woven through each other, replacing the pixel-art
  mascot everywhere it was the brand mark.

  The mark ships from `assets/brand/` (mark, wordmark, lockups, app icons, social
  card, one-colour reduction, `build.sh` to regenerate every variant). On desktop
  it is now inline SVG rather than a raster, so it inherits the surrounding text
  colour and stays sharp at any size. Loading states turn it a quarter at a time,
  which is a whole loop because the mark is symmetric under 90 degrees.

  The TUI banner is redrawn as ASCII art of the same mark. The voice-call avatar
  is deliberately untouched.

### Patch Changes

- da11bd0: Retone the desktop palette away from the candy brand, and pin contrast in CI.

  The palette led with hot pink (`#ec4899`) for every CTA, send button and focus ring, bright cyan for the accent, and pink gradients. That reads as a consumer toy in a room where the app is being evaluated for a fleet. Primary becomes a deep muted blue, the accent a desaturated teal, decorative purple and pink fold into the same family, and the status hues are toned down without losing their meaning.

  Dark mode no longer inherits the accents. The light primary is chosen to carry white text on a near-white surface, and that same ink is close to invisible on a near-black canvas, so each accent now has an explicit dark counterpart lifted into the readable range.

  A palette change is otherwise unverifiable by CI: nothing fails when colours become unreadable. New tests compute WCAG contrast for the pairings that matter in both themes, which caught a pre-existing defect: dim text sat at 2.56:1 on white, below the 3:1 large-text floor. It is darkened to 3.36:1.

  Colours are still declared in two places (the desktop stylesheet is the source of truth, design-tokens mirrors it) and the existing parity test keeps them honest.

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [8c41d00]
- Updated dependencies [950c1bb]
- Updated dependencies [5763f92]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [57d157c]
- Updated dependencies [ff64a0e]
- Updated dependencies [3b7d350]
- Updated dependencies [9e35a56]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [5a977cc]
- Updated dependencies [3dfc2f3]
- Updated dependencies [779f644]
- Updated dependencies [68f7e20]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [5763f92]
- Updated dependencies [dfb644a]
- Updated dependencies [06e81f8]
- Updated dependencies [acfe644]
- Updated dependencies [220673e]
  - @moxxy/cli@0.34.0
  - @moxxy/sdk@0.34.0
  - @moxxy/plugin-stt-whisper-codex@0.34.0
  - @moxxy/client-core@0.13.14
  - @moxxy/desktop-host@0.14.5
  - @moxxy/plugin-channel-mobile@0.34.0
  - @moxxy/runner@0.2.39
  - @moxxy/chat-model@0.3.25
  - @moxxy/client-platform-web@0.1.53
  - @moxxy/desktop-ipc-contract@0.14.10
  - @moxxy/ipc-server-ws@0.1.52
  - @moxxy/plugin-vault@0.34.0
  - @moxxy/workflows-builder@0.1.36

## 0.31.0

### Minor Changes

- b7d2f10: Add a desktop-only Voice Mode with bilingual streaming Local Piper playback, pause-safe voice activity detection, barge-in, resilient offline-voice onboarding, uninterrupted call handoff between chat and Focus Mode, and privacy-safe microphone mute/resume that keeps the hidden audio owner realtime without reacquiring the active stream. Refresh Focus Mode with the animated Moxxy persona, current-task and timed-reply bubbles, and a compact latest-turn mini chat with attachments, Markdown, multiline input, and visible queued turns.

### Patch Changes

- Updated dependencies [b7d2f10]
- Updated dependencies [651449e]
- Updated dependencies [b241085]
  - @moxxy/cli@0.33.0
  - @moxxy/sdk@0.33.0
  - @moxxy/chat-model@0.3.24
  - @moxxy/client-core@0.13.13
  - @moxxy/client-platform-web@0.1.52
  - @moxxy/desktop-host@0.14.4
  - @moxxy/desktop-ipc-contract@0.14.9
  - @moxxy/ipc-server-ws@0.1.51
  - @moxxy/plugin-channel-mobile@0.33.0
  - @moxxy/plugin-stt-whisper-codex@0.33.0
  - @moxxy/plugin-vault@0.33.0
  - @moxxy/runner@0.2.38
  - @moxxy/workflows-builder@0.1.35

## 0.30.0

### Minor Changes

- 80823f7: Redesign tool and skill activity as compact expandable traces with live shimmer feedback.

### Patch Changes

- Updated dependencies [3b0c14a]
- Updated dependencies [80823f7]
  - @moxxy/sdk@0.32.0
  - @moxxy/cli@0.32.0
  - @moxxy/chat-model@0.3.23
  - @moxxy/client-core@0.13.12
  - @moxxy/client-platform-web@0.1.51
  - @moxxy/desktop-host@0.14.3
  - @moxxy/desktop-ipc-contract@0.14.8
  - @moxxy/ipc-server-ws@0.1.50
  - @moxxy/plugin-channel-mobile@0.32.0
  - @moxxy/plugin-stt-whisper-codex@0.32.0
  - @moxxy/plugin-vault@0.32.0
  - @moxxy/runner@0.2.37
  - @moxxy/workflows-builder@0.1.34

## 0.29.3

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
- Updated dependencies [f4ae185]
- Updated dependencies [a85866c]
- Updated dependencies [bba28c1]
  - @moxxy/sdk@0.31.0
  - @moxxy/cli@0.31.0
  - @moxxy/chat-model@0.3.22
  - @moxxy/client-core@0.13.11
  - @moxxy/client-platform-web@0.1.50
  - @moxxy/desktop-host@0.14.2
  - @moxxy/desktop-ipc-contract@0.14.7
  - @moxxy/ipc-server-ws@0.1.49
  - @moxxy/plugin-channel-mobile@0.31.0
  - @moxxy/plugin-stt-whisper-codex@0.31.0
  - @moxxy/plugin-vault@0.31.0
  - @moxxy/runner@0.2.36
  - @moxxy/workflows-builder@0.1.33

## 0.29.2

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/cli@0.30.0
  - @moxxy/sdk@0.30.0
  - @moxxy/plugin-stt-whisper-codex@0.30.0
  - @moxxy/chat-model@0.3.21
  - @moxxy/client-core@0.13.10
  - @moxxy/client-platform-web@0.1.49
  - @moxxy/desktop-host@0.14.1
  - @moxxy/desktop-ipc-contract@0.14.6
  - @moxxy/ipc-server-ws@0.1.48
  - @moxxy/plugin-channel-mobile@0.30.0
  - @moxxy/plugin-vault@0.30.0
  - @moxxy/runner@0.2.35
  - @moxxy/workflows-builder@0.1.32

## 0.29.1

### Patch Changes

- 2d085b2: Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) with
  guard clauses across the desktop-group packages, per the "Guard, don't chain"
  rule. Behaviour is preserved: silent-absence paths keep their early return /
  single-level `?.` / fallback, while accesses that are impossible-by-construction
  (in-bounds loop indices, mandatory regex capture groups, class invariants,
  checked preconditions) now fail loudly at the assumption site via
  `assertDefined`/`invariant` instead of a cryptic downstream `undefined`.

  Browser-bundled code (`@moxxy/chat-model` and the desktop renderer) uses a small
  dependency-free local guard helper rather than importing the helpers from the
  `@moxxy/sdk` root barrel, which transitively pulls Node-only modules (`node:fs`)
  and cannot be bundled for the browser.

- Updated dependencies [f837396]
- Updated dependencies [6546a06]
- Updated dependencies [2d085b2]
- Updated dependencies [ea24f82]
- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/workflows-builder@0.1.31
  - @moxxy/client-core@0.13.9
  - @moxxy/client-platform-web@0.1.48
  - @moxxy/design-tokens@0.2.1
  - @moxxy/ipc-server-ws@0.1.47
  - @moxxy/plugin-channel-mobile@0.29.0
  - @moxxy/anonymizer@0.1.1
  - @moxxy/chat-model@0.3.20
  - @moxxy/desktop-host@0.14.0
  - @moxxy/desktop-ipc-contract@0.14.5
  - @moxxy/plugin-stt-whisper-codex@0.29.0
  - @moxxy/sdk@0.29.0
  - @moxxy/cli@0.29.0
  - @moxxy/plugin-vault@0.29.0
  - @moxxy/runner@0.2.34

## 0.29.0

### Minor Changes

- 2da5496: feat(desktop): route the mic through the runner's active transcriber (local STT) with Codex fallback

  The desktop microphone was hardwired to the in-process Codex cloud transcriber.
  It now prefers the RUNNER's active transcriber — a runner-side STT plugin such
  as the local Whisper `@moxxy/plugin-stt-local` — so with that plugin installed
  and active the desktop mic transcribes **fully offline**. Without it, behavior
  is byte-identical to before.

  - `session.transcribe` (desktop-host IPC) tries the runner's active transcriber
    first via the existing `Transcribe` runner RPC (`RemoteSession.transcribers.
tryGetActive()`, mirroring how `session.synthesize` routes TTS). It falls back
    to the in-process Codex transcriber only when the runner reports **no active
    transcriber**. An error from a _present-but-failing_ runner transcriber (a
    broken local model) surfaces to the user instead of silently falling through
    to the cloud — "none active" and "failed" are distinguished.
  - `session.hasTranscriber` (the mic-affordance gate) is now true when EITHER the
    runner reports an active transcriber (read off the existing
    `SessionInfo.activeTranscriber` snapshot — no new RPC) OR the Codex OAuth vault
    probe passes. Keyed on the ACTIVE transcriber so it stays in lockstep with the
    transcribe routing.
  - `session.transcribe` gains an optional `workspaceId` (like `session.synthesize`)
    so a background workspace's mic targets the right runner; the renderer is
    unchanged and defaults to the active workspace.

  No runner-protocol change: the `Transcribe` RPC, its handler, and the
  `RemoteSession` transcriber proxy already existed and are unchanged, so
  `RUNNER_PROTOCOL_VERSION` is not bumped. The mic capture's `audio/x-moxxy-pcm16-
24khz` (PCM16 24 kHz) mimeType flows through to whichever transcriber unchanged.

### Patch Changes

- 3fa16fe: Fix the plugins-seed bundling script on Windows: resolve the repo root via `fileURLToPath` (the `url.pathname` form produced a doubled drive letter, `D:\D:\a\...`, crashing the desktop release job) and spawn pnpm/npm through the shell so their `.cmd` shims work on Windows runners.
- 6c0af71: Tech-debt backlog cleanup pass.

  - CLI: new `moxxy channels rotate-token <name>` verb wrapping the SDK-only `rotateChannelToken` (SECURITY.md's hardening checklist recommended rotation but nothing exposed it).
  - CLI: standalone `moxxy mobile` now stamps `MOXXY_SESSION_SOURCE=mobile` (via a declared `sessionSource` on the channel def) so the empty pre-first-prompt session is no longer mis-stamped `tui` and dropped from the mobile list.
  - SDK: `resolveModelContext` no longer SILENTLY falls back to the first model descriptor on an unrecognized model id — it emits a one-shot `console.warn` (deduped per provider/requested-id/fallback-id) so a wrong context-window calibration is observable.
  - Desktop: compile-time partition of the app-bridge method sets (`RENDERER_DISPATCHED_METHODS` vs the host `BridgeServices` map) so a mis-/un-classified method is now a `tsc` error rather than a runtime-test-only check.
  - Desktop: the keyless `local` provider no longer prompts for a non-existent API key in the Configure sheet.
  - Desktop: stop Vite emitting a ~21 MB orphan ONNX-Runtime wasm into `dist/assets/` on every bundle (the runtime loads ORT from `/ort/`; the emitted copy was dead); the real anonymizer wasm is untouched.
  - Desktop: added a drift guard that fails if the hand-mirrored channel catalog diverges from each plugin's `ChannelDef.config`.

- Updated dependencies [2da5496]
- Updated dependencies [6c0af71]
  - @moxxy/desktop-host@0.13.2
  - @moxxy/desktop-ipc-contract@0.14.4
  - @moxxy/cli@0.28.1
  - @moxxy/sdk@0.28.1
  - @moxxy/client-core@0.13.8
  - @moxxy/ipc-server-ws@0.1.46
  - @moxxy/plugin-channel-mobile@0.28.1
  - @moxxy/chat-model@0.3.19
  - @moxxy/client-platform-web@0.1.47
  - @moxxy/plugin-stt-whisper-codex@0.28.1
  - @moxxy/plugin-vault@0.28.1
  - @moxxy/runner@0.2.33
  - @moxxy/workflows-builder@0.1.30

## 0.28.1

### Patch Changes

- 3e4b2b4: Goal mode refactor: deliver the outcome, then get out of the way. Goal runs are now guardrail-free — no iteration cap, no token budget, and a stuck-loop trip steers the model with a nudge instead of killing the run (the only terminals are goal_complete, goal_abandon, an idle stall, user abort, or a genuinely fatal error). Goal mode is also one-shot (`ModeDef.transient`): it arms per objective, hands the session back to the previous mode when the goal concludes, is never persisted as the boot/category default, and channels no longer flip session-wide yolo/auto-approve (the run auto-approves via its own scoped resolver). Also fixes the shared ReAct loop's checkpoint injection budget to be per idle-episode, so long autonomous runs no longer die on their Nth spread-out idle round. SDK additions: `emitRequestsAndNudgeOnStuck`, `stuck.action: 'nudge'` on `runReactLoop`, `StuckLoopDetector.reset()`, `ModeDef.transient`, `ModeContext.previousModeName`.
- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
- Updated dependencies [3bf5b52]
  - @moxxy/sdk@0.28.0
  - @moxxy/cli@0.28.0
  - @moxxy/chat-model@0.3.18
  - @moxxy/client-core@0.13.7
  - @moxxy/client-platform-web@0.1.46
  - @moxxy/desktop-host@0.13.1
  - @moxxy/desktop-ipc-contract@0.14.3
  - @moxxy/ipc-server-ws@0.1.45
  - @moxxy/plugin-channel-mobile@0.28.0
  - @moxxy/plugin-stt-whisper-codex@0.28.0
  - @moxxy/plugin-vault@0.28.0
  - @moxxy/runner@0.2.32
  - @moxxy/workflows-builder@0.1.29

## 0.28.0

### Minor Changes

- a4691d9: Desktop plugins seed: the packaged app now bundles a ready-to-copy npm tree
  of the on-demand first-party plugins (API-key providers + the slim-wave
  unbundled set) and copies it into `~/.moxxy/plugins` on first launch —
  an OFFLINE first run with no npm and no network, while the CLI binary stays
  slim. Idempotent: never overwrites a user-updated install; merges the seed's
  dependency ledger into the target manifest so later `npm install --save`
  runs keep working. Assembled at build time from local pnpm-pack tarballs
  (including the sdk/core closure), so the desktop build does not depend on
  the same release's npm publish having landed.

### Patch Changes

- 6460cc6: The slim wave's last unbundle: `@moxxy/plugin-memory` moves out of the CLI
  binary as ONE merged plugin (long-term store + memory tools + the tfidf
  embedder + memory_consolidate and its nudge hooks — the two-plugins-in-one-
  package blocker is gone). The store's embedder now resolves lazily from the
  new core-published `embedders` service instead of a bootstrap closure.
  Installs on demand / rides the desktop seed; without it, `moxxy doctor`
  reports a warn ("memory plugin not installed") instead of failing and
  recall degrades exactly as before. The `@moxxy/memory-consolidate` ledger
  key is gone (clean-slate) — enable/disable the one package instead.
- fa3922e: Slim wave, batches 3+4: `@moxxy/plugin-browser`, `@moxxy/plugin-terminal`
  and `@moxxy/plugin-channel-web` move out of the CLI binary and install on
  demand (all three are in the desktop plugins-seed, so desktop surfaces keep
  working offline). The CLI's `dist/` drops the Playwright `sidecar.js` entry
  and the copied web frontend — a standalone browser install resolves its own
  `dist/sidecar.js`, and the web channel serves its own `dist/public` next to
  its module. `node-pty` moves from the CLI's optionalDependencies into
  plugin-terminal's own (piped-shell fallback without it).
  `@moxxy/plugin-tunnel-proxy` + `@moxxy/e2e` flip public as web's dependency
  closure; `@moxxy/e2e` joins the fixed changeset group so pinned installs
  resolve from their first release.
- 502acf0: Slim wave, final batches: the whisper STT pair, the Telegram + Slack
  channels, provider-admin and mcp move out of the CLI binary — all seeded
  into the desktop (voice, Settings panels and Apps→Channels keep working
  offline) and installable on demand everywhere else. `moxxy telegram` /
  `moxxy channels start slack` on a slim install print the exact install
  command instead of "unknown command". `@moxxy/config` flips public as the
  channels' dependency closure. The kernel is now the plan's target set: the
  TUI, built-in tools, default mode, context floors, vault, plugins-admin,
  commands, memory, the two OAuth providers, and the dormant daemons.
- Updated dependencies [03e5f87]
- Updated dependencies [f783303]
- Updated dependencies [a4691d9]
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [6460cc6]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [e5ea7e6]
- Updated dependencies [2cef8e1]
- Updated dependencies [720c955]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [6f0e6fb]
- Updated dependencies [b2a5fba]
- Updated dependencies [fa3922e]
- Updated dependencies [502acf0]
- Updated dependencies [4c605fc]
- Updated dependencies [be28d55]
  - @moxxy/plugin-vault@0.27.0
  - @moxxy/cli@0.27.0
  - @moxxy/desktop-host@0.13.0
  - @moxxy/sdk@0.27.0
  - @moxxy/runner@0.2.31
  - @moxxy/desktop-ipc-contract@0.14.2
  - @moxxy/plugin-stt-whisper-codex@0.27.0
  - @moxxy/plugin-channel-mobile@0.27.0
  - @moxxy/chat-model@0.3.17
  - @moxxy/client-core@0.13.6
  - @moxxy/client-platform-web@0.1.45
  - @moxxy/ipc-server-ws@0.1.44
  - @moxxy/workflows-builder@0.1.28

## 0.27.1

### Patch Changes

- 3c0dcfb: Add pasted-image attachments, pannable previews, and remembered mini-chat sizing to Focus Mode.
- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [04738aa]
- Updated dependencies [ce56ef6]
- Updated dependencies [386e526]
- Updated dependencies [386e526]
  - @moxxy/sdk@0.26.0
  - @moxxy/cli@0.26.0
  - @moxxy/chat-model@0.3.16
  - @moxxy/client-core@0.13.5
  - @moxxy/client-platform-web@0.1.44
  - @moxxy/desktop-host@0.12.1
  - @moxxy/desktop-ipc-contract@0.14.1
  - @moxxy/ipc-server-ws@0.1.43
  - @moxxy/plugin-channel-mobile@0.26.0
  - @moxxy/plugin-stt-whisper-codex@0.26.0
  - @moxxy/plugin-vault@0.26.0
  - @moxxy/runner@0.2.30
  - @moxxy/workflows-builder@0.1.27

## 0.27.0

### Minor Changes

- f346b38: Make collaboration a fully separate feature that never touches your chats or their sessions.

  Previously `/collab` (and the desktop Collaborate tab) ran the coordinator **inside the active chat session** — it flipped that session's mode to `collaborative` and streamed the whole team's activity into the chat's own event log, so a collaboration polluted the chat thread and its transcript.

  Now the coordinator runs on its **own dedicated runner** — a new internal `moxxy collab` command that boots its own headless Session + runner socket, hosts the collab hub, and spawns the architect/implementer team exactly as before.

  - **Desktop:** the Collaborate panel supervises that coordinator (`CollabSupervisor`) and drives it over a dedicated `collab.*` IPC surface + `collab.event` / `collab.approval` broadcasts (a private `useCollab` hook, not `useChat`). The roster-approval checkpoint is answered inline in the panel.
  - **TUI:** `/collab <goal>` re-points the terminal onto the coordinator's own session (via the same in-place switch `/sessions` uses) and auto-submits the goal there — the roster approval and the live `◆ collab` block render as usual, but on the coordinator's session, not your chat. Bare `/collab` attaches to a running collaboration to view it; `/sessions` returns you to chat while the collaboration keeps running.

  Either way, a collaboration is entirely decoupled from every chat session — no mode-switch, no events in a chat's thread. The roster-approval checkpoint (the one human-in-the-loop gate) is preserved because the attaching UI drives the goal turn, so the coordinator's approval is forwarded to it. The single-flight lock now also records the coordinator's runner socket so a UI can discover and attach to a running coordinator (including one started elsewhere).

### Patch Changes

- dc343bd: Fix Codex `gpt-5.5` / `gpt-5.4` advertising a 1,000,000-token context window when the ChatGPT-plan Codex backend only serves ~400k for these gpt-5-family models. The inflated window pushed the proactive compactor's `estimatedTokens > 0.75 * contextWindow` gate out to ~750k — unreachable before the backend rejected the request — so long sessions always fell through to the reactive compact-on-overflow retry ("context window exceeded — compacted older turns, retrying") instead of compacting cleanly ahead of the limit. Set both to `400_000`, matching the rest of the Codex catalog, so the proactive compactor trips before overflow.
- eb04333: Recover the initial desktop session when its startup connection event is missed.
- eb04333: Keep the Focus Mode tile visible across macOS Spaces on the first toggle after launch.
- 1162b84: Add desktop chat image preview modals for pending and historical image attachments.
- eb04333: Hydrate resumed session metadata from JSONL history so workspace titles do not fall back to New session.
- Updated dependencies [dc343bd]
- Updated dependencies [f346b38]
- Updated dependencies [eb04333]
  - @moxxy/cli@0.25.0
  - @moxxy/desktop-ipc-contract@0.14.0
  - @moxxy/desktop-host@0.12.0
  - @moxxy/plugin-stt-whisper-codex@0.0.38
  - @moxxy/client-core@0.13.4
  - @moxxy/ipc-server-ws@0.1.42
  - @moxxy/plugin-channel-mobile@0.2.14
  - @moxxy/client-platform-web@0.1.43
  - @moxxy/sdk@0.25.0
  - @moxxy/chat-model@0.3.15
  - @moxxy/plugin-vault@0.0.38
  - @moxxy/runner@0.2.29
  - @moxxy/workflows-builder@0.1.26

## 0.26.1

### Patch Changes

- 8df816a: Fix: the Telegram connect step in the desktop Channels panel could stay stuck on "Connecting…" and never show the QR. The dedicated channel runner could be wedged before it published its status file in three independent ways, now all closed:

  - A desktop-spawned channel runner now opts out of the co-attached web surface (`MOXXY_NO_WEB_SURFACE`, mirroring `moxxy serve`). Without it a remote channel (Telegram) opened a proxy tunnel during startup — _before_ the status write — so a slow/unreachable relay blocked it indefinitely; it also raced the fixed web port (4040) with `serve` and other channel runners.
  - The dedicated runner writes its status file _before_ the optional web-surface co-attach, so its readiness/connect value is published independently of that tunnel.
  - The up-front `getMe` (which resolves the `t.me` link) is now bounded by a timeout, so a slow/unreachable Telegram can't wedge `start()` — the channel comes up (and pairing still works) even when the link can't be resolved.

- Updated dependencies [8df816a]
  - @moxxy/cli@0.24.1
  - @moxxy/sdk@0.24.1
  - @moxxy/chat-model@0.3.14
  - @moxxy/client-core@0.13.3
  - @moxxy/client-platform-web@0.1.42
  - @moxxy/desktop-host@0.11.3
  - @moxxy/desktop-ipc-contract@0.13.3
  - @moxxy/ipc-server-ws@0.1.41
  - @moxxy/plugin-channel-mobile@0.2.13
  - @moxxy/plugin-stt-whisper-codex@0.0.37
  - @moxxy/plugin-vault@0.0.37
  - @moxxy/runner@0.2.28
  - @moxxy/workflows-builder@0.1.25

## 0.26.0

### Minor Changes

- f71c8bd: Telegram chat pairing now works from the desktop, via a single QR mechanism used everywhere.

  Previously, starting Telegram from the desktop Channels panel errored with "No Telegram chat is paired yet" — the channel refused to start unpaired and the only pairing path was the TTY-only paste-a-code flow. Now, when unpaired, Telegram opens a host-issued pairing window: it mints a one-time code, publishes a `t.me/<bot>?start=<code>` deep link as its connect value, and the panel renders it as a QR. The user scans → taps **START** in Telegram (or sends the 6 digits) and the chat pairs — zero typing — after which the panel shows "✓ Connected".

  This is the **single** pairing mechanism everywhere: `moxxy channels telegram pair` now renders the same QR in the terminal (and waits for the scan) instead of the old bot-DMs-a-code / paste-in-the-terminal flow, which is removed.

  New SDK surface: `Channel.connected` and `ChannelHandle.onConnectChange`, plus a `connected` field on the channel status file, so a dedicated-runner host can swap the QR for "Connected" live.

### Patch Changes

- 50c4078: Keep the Focus Mode tile at its pre-open position when collapsing back from the mini chat.
- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/cli@0.24.0
  - @moxxy/chat-model@0.3.13
  - @moxxy/client-core@0.13.2
  - @moxxy/client-platform-web@0.1.41
  - @moxxy/desktop-host@0.11.2
  - @moxxy/desktop-ipc-contract@0.13.2
  - @moxxy/ipc-server-ws@0.1.40
  - @moxxy/plugin-channel-mobile@0.2.12
  - @moxxy/plugin-stt-whisper-codex@0.0.36
  - @moxxy/plugin-vault@0.0.36
  - @moxxy/runner@0.2.27
  - @moxxy/workflows-builder@0.1.24

## 0.25.0

### Minor Changes

- aec6e0e: Declarative per-channel "connect step" in the desktop Channels panel. A channel now declares how its post-start "connect the other side" affordance is presented (`ChannelConnectStep` on `ChannelConfigDescriptor`: `kind: 'qr' | 'url' | 'instructions'`), and the desktop renders it uniformly — no per-channel UI code.

  Telegram is the first consumer: on start it resolves its bot's `@username` (grammy `getMe`) and publishes a `https://t.me/<bot>` link through the existing `requestUrl` status spine, which the panel shows as a **QR + "Open in Telegram"** link. Slack's Request URL folds into the same mechanism (`kind: 'url'`). The QR renderer is shared between the Mobile gateway and the Channels panel.

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/chat-model@0.3.12
  - @moxxy/cli@0.23.0
  - @moxxy/client-core@0.13.1
  - @moxxy/client-platform-web@0.1.40
  - @moxxy/desktop-host@0.11.1
  - @moxxy/desktop-ipc-contract@0.13.1
  - @moxxy/ipc-server-ws@0.1.39
  - @moxxy/plugin-channel-mobile@0.2.11
  - @moxxy/plugin-stt-whisper-codex@0.0.35
  - @moxxy/plugin-vault@0.0.35
  - @moxxy/runner@0.2.26
  - @moxxy/workflows-builder@0.1.23

## 0.24.5

### Patch Changes

- f980349: Run Slack & Telegram channels from the desktop, each on its own dedicated runner.

  - **Apps → Channels** (new sub-tab): per channel, enter its secrets (stored in
    the vault), Start/Stop its dedicated-runner subprocess, and — for Slack — copy
    the public Request URL to paste into the Slack app once its proxy tunnel opens.
    The channel runs as a separate isolated session, so its conversation is
    intentionally not shown in the workspace sidebar; the panel manages the runner.
  - New IPC: `channels.list` / `channels.saveConfig` / `channels.start` /
    `channels.stop` + a `channels.status` event (host-only — NOT remote-reachable).
    A `ChannelSupervisor` in `@moxxy/desktop-host` spawns `moxxy <channel>` with
    `MOXXY_DEDICATED_RUNNER=1`, supervises it, and reads the channel's status file
    for the Request URL. Secrets are written to the same in-process vault the runner
    reads, keyed by the names each channel plugin uses (a small static catalog).
  - A dedicated channel runner now publishes a tiny status file
    (`~/.moxxy/channel-<name>.status.json`) with its pid + public ingest URL while
    running, removed on shutdown — so a supervisor can observe it without the runner
    protocol. New `@moxxy/sdk/server` helpers (`writeChannelStatus` /
    `readChannelStatus` / `clearChannelStatus`) + an optional `Channel.requestUrl`
    getter back this.

- fb0dba0: Fix Focus Mode toggling, fullscreen support, collapsed tile dragging and shaping, inactive reply previews, Focus Mode permission prompts, theme-aware Focus Mode colors, and add a labelled in-app toolbar toggle.
- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/cli@0.22.0
  - @moxxy/desktop-ipc-contract@0.13.0
  - @moxxy/desktop-host@0.11.0
  - @moxxy/client-core@0.13.0
  - @moxxy/chat-model@0.3.11
  - @moxxy/client-platform-web@0.1.39
  - @moxxy/ipc-server-ws@0.1.38
  - @moxxy/plugin-channel-mobile@0.2.10
  - @moxxy/plugin-stt-whisper-codex@0.0.34
  - @moxxy/plugin-vault@0.0.34
  - @moxxy/runner@0.2.25
  - @moxxy/workflows-builder@0.1.22

## 0.24.4

### Patch Changes

- 5449862: fix(desktop): provision API-key providers on demand during onboarding

  The slim-kernel redesign stopped bundling API-key providers (anthropic, openai,
  …) into the CLI — they install on demand from npm. But the desktop's onboarding
  had no install step: picking the default `anthropic` (or any API-key provider)
  saved the key, then `setActive` threw "Provider not registered" and the
  onboarding / provider-recovery gate looped forever. Only the two bundled OAuth
  providers (claude-code, openai-codex) yielded a working desktop.

  Onboarding now runs the CLI's headless provisioner — a new
  `onboarding.provisionProvider` IPC that shells out to `moxxy provision <slug>`
  (the key was already stored via `saveProviderKey`) to install + enable the
  package and write `plugins.provider.default`, then restarts the runner so it
  discovers the freshly-installed package and its boot activation makes the
  provider active. OAuth providers keep their bundled `setProvider` path.

- Updated dependencies [1a7e4c3]
- Updated dependencies [2cf7695]
  - @moxxy/cli@0.21.1
  - @moxxy/sdk@0.21.1
  - @moxxy/chat-model@0.3.10
  - @moxxy/client-core@0.12.3
  - @moxxy/client-platform-web@0.1.38
  - @moxxy/desktop-host@0.10.5
  - @moxxy/desktop-ipc-contract@0.12.3
  - @moxxy/ipc-server-ws@0.1.37
  - @moxxy/plugin-channel-mobile@0.2.9
  - @moxxy/plugin-stt-whisper-codex@0.0.33
  - @moxxy/plugin-vault@0.0.33
  - @moxxy/runner@0.2.24
  - @moxxy/workflows-builder@0.1.21

## 0.24.3

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [05df794]
- Updated dependencies [e7b6853]
- Updated dependencies [5c943a3]
- Updated dependencies [3a4b604]
- Updated dependencies [d924a73]
  - @moxxy/sdk@0.21.0
  - @moxxy/cli@0.21.0
  - @moxxy/chat-model@0.3.9
  - @moxxy/client-core@0.12.2
  - @moxxy/client-platform-web@0.1.37
  - @moxxy/desktop-host@0.10.4
  - @moxxy/desktop-ipc-contract@0.12.2
  - @moxxy/ipc-server-ws@0.1.36
  - @moxxy/plugin-channel-mobile@0.2.8
  - @moxxy/plugin-stt-whisper-codex@0.0.32
  - @moxxy/plugin-vault@0.0.32
  - @moxxy/runner@0.2.23
  - @moxxy/workflows-builder@0.1.20

## 0.24.2

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [497e9a1]
- Updated dependencies [08e9eb2]
- Updated dependencies [bddaa83]
- Updated dependencies [e3491a9]
- Updated dependencies [5c1c334]
- Updated dependencies [238e434]
- Updated dependencies [15299d8]
- Updated dependencies [2ccd62e]
- Updated dependencies [d643573]
  - @moxxy/sdk@0.20.0
  - @moxxy/cli@0.16.0
  - @moxxy/chat-model@0.3.8
  - @moxxy/client-core@0.12.1
  - @moxxy/client-platform-web@0.1.36
  - @moxxy/desktop-host@0.10.3
  - @moxxy/desktop-ipc-contract@0.12.1
  - @moxxy/ipc-server-ws@0.1.35
  - @moxxy/plugin-channel-mobile@0.2.7
  - @moxxy/plugin-stt-whisper-codex@0.0.31
  - @moxxy/plugin-vault@0.0.31
  - @moxxy/runner@0.2.22
  - @moxxy/workflows-builder@0.1.19

## 0.24.1

### Patch Changes

- d573742: Desktop: show context usage at a glance on the composer's model control.

  - The borderless **model label** (e.g. `gpt-5.5 ▾`) now carries a hair-thin context-window meter directly beneath it — a tiny fill bar plus a tabular percentage that color-ramps to amber (≥60%) and red (≥85%) as the window fills, so current context usage is visible without opening the panel. It appears as soon as the active model's context window is known and stays in sync with the full meter inside **Model & context**.
  - In the **Model & context** panel, **Prompt composition** is now a collapsible section, collapsed by default. The header keeps its `N calls · … prompt` teaser and gains a disclosure caret; expanding it reveals the cache-read / fresh-input / cache-write breakdown, cache-hit/savings line, and the per-call sparkline.

## 0.24.0

### Minor Changes

- 08f927a: feat: pick which session ambient triggers run in + a compact trigger marker

  Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
  session **created** them, and the synthesized prompt — often a large block
  carrying an untrusted webhook payload — rendered as a giant user bubble. Two
  changes:

  **Pick the target session.** Each trigger can now be pinned to a chosen session
  (where its run executes _and_ displays), decoupled from who created it:

  - `webhook_create` / `schedule_create` take an optional `targetSessionId`
    (defaulting to the creating session), and `webhook_update` /
    `schedule_set_target` reassign it. These map onto the existing
    `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
    owner-gate already deliver to the right runner — no routing change.
  - Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
    onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
    watched only by the target runner; a cross-session `afterWorkflow` dependent
    is skipped with a warning (the completion event is in-process to the parent's
    runner). The visual builder preserves the field across a round-trip.
  - Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
    gain a session picker (new `*.setTargetSession` IPC commands), and each
    summary surfaces the resolved target-session name.

  **Compact trigger marker.** A fired trigger now renders as a one-line,
  expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
  "Workflow ran · digest") instead of the raw prompt — click to reveal the full
  payload. The prompt still lives in the model's context (security fences intact);
  only the display changes (new optional `origin` on the `user_prompt` event,
  threaded from the fired turn via `RunTurnOptions.origin`).

  Unset everywhere preserves today's behavior; single-process CLI/TUI is
  unaffected.

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/desktop-ipc-contract@0.12.0
  - @moxxy/client-core@0.12.0
  - @moxxy/workflows-builder@0.1.18
  - @moxxy/desktop-host@0.10.2
  - @moxxy/plugin-channel-mobile@0.2.6
  - @moxxy/cli@0.15.1
  - @moxxy/chat-model@0.3.7
  - @moxxy/client-platform-web@0.1.35
  - @moxxy/ipc-server-ws@0.1.34
  - @moxxy/plugin-stt-whisper-codex@0.0.30
  - @moxxy/plugin-vault@0.0.30
  - @moxxy/runner@0.2.21

## 0.23.1

### Patch Changes

- 4c9a621: fix(desktop): app failed to start after the Apps Webhooks panel (#338)

  #338 registered the webhooks IPC with a static top-level
  `import … from '@moxxy/plugin-webhooks'` in `@moxxy/desktop-host`, which is
  bundled into the Electron main entry (`BUNDLED_WORKSPACE_DEPS`). That dragged
  the webhooks plugin's proxy/E2E stack and, transitively, `ulid` into the main
  entry's eager module graph, reordering ESM init so `ulid` initialised before
  electron-vite's injected `require` shim. `ulid` then threw "secure crypto
  unusable, insecure Math.random not allowed" at boot, so the updated bundle
  (0.23.0) load-errored and fell back to the floor — the identical regression the
  0.22.3 mobile-proxy fix addressed.

  Fix: defer the webhooks plugin to a lazy `import()` inside the IPC handlers
  (only the erased `import type` stays static), so the proxy/E2E stack + `ulid`
  load on the first `webhooks.*` call — post `app.whenReady`, out of the startup
  path. App startup is restored; the Webhooks panel is unchanged.

- Updated dependencies [4c9a621]
  - @moxxy/desktop-host@0.10.1

## 0.23.0

### Minor Changes

- c4b7f1c: Desktop: declutter the composer toolbar and turn Apps into the ambient-automation hub.

  **Composer toolbar**

  - **Mode** moves into the `+` overflow as a disclosure submenu (`Mode: default ▸` → the mode list, active one checked), so it no longer takes a top-level chip.
  - **Model** moves to the right of the toolbar as a quiet, borderless label (the active model name, provider as fallback) instead of a chip button. Clicking it opens a combined **Model & context** panel — the provider/model picker on top, the context-window usage + one-click compaction below — replacing the separate model chip and context meter.

  **Top navigation + Apps**

  - The top-level switcher is now **Chat · Collaborate · Apps** — the separate **Actions** tab is gone; its Workflows / Schedules / Webhooks grouping moves into Apps.
  - The **Apps** view keeps the installable-app gallery as its landing and gains a right-aligned sub-nav: **Workflows · Schedules · Webhooks**. Each chip swaps the body to that surface; re-clicking the active chip returns to the gallery.
    - Workflows / Schedules reuse the existing embedded panels.
    - **Webhooks** is upgraded from the previous stage-1 placeholder (which only listed webhook-triggered workflows) to a real panel backed by new host-only `webhooks.list` / `webhooks.setEnabled` / `webhooks.delete` IPC, which read the shared webhooks store directly (so triggers created from chat appear) with verification secrets redacted at the boundary.

### Patch Changes

- Updated dependencies [c4b7f1c]
  - @moxxy/desktop-ipc-contract@0.11.0
  - @moxxy/client-core@0.11.0
  - @moxxy/desktop-host@0.10.0
  - @moxxy/ipc-server-ws@0.1.33
  - @moxxy/plugin-channel-mobile@0.2.5
  - @moxxy/client-platform-web@0.1.34
  - @moxxy/cli@0.15.0

## 0.22.9

### Patch Changes

- Updated dependencies [50918af]
  - @moxxy/client-core@0.10.6
  - @moxxy/client-platform-web@0.1.33

## 0.22.8

### Patch Changes

- Updated dependencies [e4fe785]
- Updated dependencies [e62b6f5]
  - @moxxy/sdk@0.18.0
  - @moxxy/cli@0.15.0
  - @moxxy/chat-model@0.3.6
  - @moxxy/client-core@0.10.5
  - @moxxy/client-platform-web@0.1.32
  - @moxxy/desktop-host@0.9.2
  - @moxxy/desktop-ipc-contract@0.10.6
  - @moxxy/ipc-server-ws@0.1.32
  - @moxxy/plugin-channel-mobile@0.2.4
  - @moxxy/plugin-stt-whisper-codex@0.0.29
  - @moxxy/plugin-vault@0.0.29
  - @moxxy/runner@0.2.20
  - @moxxy/workflows-builder@0.1.17

## 0.22.7

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/chat-model@0.3.5
  - @moxxy/cli@0.14.14
  - @moxxy/client-core@0.10.4
  - @moxxy/client-platform-web@0.1.31
  - @moxxy/desktop-host@0.9.1
  - @moxxy/desktop-ipc-contract@0.10.5
  - @moxxy/ipc-server-ws@0.1.31
  - @moxxy/plugin-channel-mobile@0.2.3
  - @moxxy/plugin-stt-whisper-codex@0.0.28
  - @moxxy/plugin-vault@0.0.28
  - @moxxy/runner@0.2.19
  - @moxxy/workflows-builder@0.1.16

## 0.22.6

### Patch Changes

- Updated dependencies [3862cb2]
  - @moxxy/desktop-host@0.9.0
  - @moxxy/plugin-channel-mobile@0.2.2
  - @moxxy/cli@0.14.13
  - @moxxy/runner@0.2.18
  - @moxxy/ipc-server-ws@0.1.30

## 0.22.5

### Patch Changes

- 062955f: Promote the mobile gateway to its own sidebar entry (above Settings) and make it on-demand only.

  - Move the mobile pairing surface out of Settings into a dedicated top-level **Mobile** view in the sidebar.
  - The gateway no longer auto-starts with the app — it stays off on every launch and is enabled explicitly per session (the persisted pairing token/identity are kept, so re-enabling reuses the same QR).
  - Tear the gateway down through its manager on quit so the end-to-end proxy tunnel is closed and the relay deregisters this machine — fixing the "unresponsive until you regenerate the code" pairing left behind by a leaked tunnel from the previous run.

- Updated dependencies [062955f]
  - @moxxy/desktop-ui@0.1.1

## 0.22.4

### Patch Changes

- 648c966: Keep collaborative peers on the selected model and keep mobile overlays interactive while turns stream.
- 648c966: Refresh desktop session lists in realtime when mobile or other remote transports change the active session.
- 648c966: Fix self-signed desktop certificate generation when random serial numbers contain DER padding bytes.
- 648c966: Move sidebar rename actions into modal forms and keep session delete behind a destructive confirmation.
- 648c966: Keep the desktop chat surface in a loading state while a newly selected session's runner is still starting, and keep retrying model/provider metadata until a cold runner exposes it.
- 648c966: Keep desktop runner spawns on the inherited shell Node before GUI PATH fallbacks, preventing dev and packaged launches from picking an older system Node.
- 648c966: Stabilize desktop jump-to-latest, keep loaded transcripts visible while large sessions reconnect, and align the mobile session picker with the desktop workspace tree.
- 648c966: Prevent foreign session events from polluting shared workspace session lists and transcripts.
- 648c966: Route paused workflow questions through the global ask surface so they remain answerable across desktop and mobile views.
- 648c966: Synchronize cleared chat transcripts across desktop and mobile clients in realtime.
- 648c966: Refresh the Mobile gateway device count live when remote clients connect or disconnect.
- 648c966: Render mobile chat image previews and desktop-compatible markdown formatting.
- 648c966: Make the full mobile plugin app use the working mobile bridge end to end: Expo web origins are allowed by `moxxy mobile`, QR pairing is WS-only via `ws(s)://...?t=token`, `@moxxy/client-transport-ws` exposes a closeable `makeWsApiHandle`, the standalone bridge exposes desktop-style desks/sessions, Expo Web NativeWind styles now render correctly, and the app now shows/selects real bridge sessions before chatting with the agent.

  Share the workspace/session registry across TUI, Desktop, and Mobile: sessions created outside a known workspace now land in the stable global `Moxxy` workspace, CLI/TUI persistence syncs session metadata into the registry, Desktop reads the same registry, and remote mobile clients can list/switch desks through the safe WS IPC allow-list.

  Harden the shared registry sync so tests and empty probe sessions do not leak into a real user profile: session persistence now honors `MOXXY_HOME`, `readIndex()` backfills missing first prompts from the JSONL log, CLI/TUI waits for a real user prompt before registering a session, stale session cwd values fall back safely, and desktop runner spawn errors no longer crash the main process.

  Keep legacy desktop sessions readable from Mobile by falling back to the desktop chat mirror when a registry session id has no matching core session log.

  Allow the shared chat store to retry loading a session transcript when an earlier read returned an empty page, so switching back to a persisted Desktop/Mobile session can recover history once the host is ready.

  Make session history recovery use the core session JSONL as the canonical source whenever it exists, repairing missing, empty, or partial desktop chat mirrors so older multi-session conversations open with their full transcript on Desktop and Mobile.

- 648c966: Keep mobile-deleted scheduler entries hidden across source syncs, reduce Live Activity completion lag, and ship the mobile app icon.
- 648c966: Add a mobile Scheduler screen backed by the desktop scheduler store, with list, pause/resume, and delete controls.
- 648c966: Keep Mobile chat streaming responsive on long sessions by memoizing committed transcript items and virtualizing the chat list.
- 648c966: Keep mobile subagent/tool details live and forward mobile inline attachments through the desktop host.
- 648c966: Fix sidebar session action menus so Rename and Delete remain clickable, show renamed sessions immediately in the desktop sidebar, and keep the sidebar profile footer from crashing keyless dev builds.
- 648c966: Sync desktop/mobile session state, auto-approve, and OpenAI cached-token usage for context meters.
- 648c966: Synchronize active turns, permission prompts, and model selection across desktop and mobile clients in realtime.
- 648c966: Preserve optimistic desktop session selection when stale desk broadcasts arrive during runner startup.
- 648c966: Restore sticky session provider and model when desktop/mobile resumes a session.
- 648c966: Deduplicate transcript history events by id while loading and appending chat logs.
- 648c966: Preserve transcript scroll anchoring when older history expands the first visible tool group.
- 648c966: Stabilize mobile workflow state and route paused workflow runs through the global ask surface.
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [d5a3014]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
- Updated dependencies [e5d3ced]
- Updated dependencies [648c966]
- Updated dependencies [648c966]
  - @moxxy/cli@0.14.12
  - @moxxy/plugin-channel-mobile@0.2.1
  - @moxxy/sdk@0.16.1
  - @moxxy/chat-model@0.3.4
  - @moxxy/client-core@0.10.3
  - @moxxy/client-platform-web@0.1.30
  - @moxxy/desktop-host@0.8.5
  - @moxxy/desktop-ipc-contract@0.10.4
  - @moxxy/ipc-server-ws@0.1.29
  - @moxxy/plugin-stt-whisper-codex@0.0.27
  - @moxxy/plugin-vault@0.0.27
  - @moxxy/runner@0.2.17
  - @moxxy/workflows-builder@0.1.15

## 0.22.3

### Patch Changes

- ff073e2: fix(desktop): app failed to start after the mobile proxy integration

  The Start-mobile proxy wiring added a static top-level import of
  `@moxxy/plugin-channel-mobile/e2e-proxy` to the Electron main. Because that
  package is bundled into the main entry (it's in `BUNDLED_WORKSPACE_DEPS`), the
  import pulled the E2E stack — and transitively `ulid` — into the main entry's
  static module graph, reordering ESM init so `ulid`'s eager initialization ran
  before electron-vite's injected `require` shim. `ulid` then threw "secure crypto
  unusable, insecure Math.random not allowed" at boot, so the desktop app never
  started.

  Fix: load the proxy opener via a lazy `import()` (injected into
  `MobileGatewayManager`) so the E2E stack stays out of the startup path and is
  loaded only when the user enables the mobile gateway — in a `ulid`-free lazy
  chunk, post `app.whenReady`. App startup is restored; the proxy "Start mobile"
  behavior is unchanged.

## 0.22.2

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/plugin-channel-mobile@0.2.0
  - @moxxy/chat-model@0.3.3
  - @moxxy/cli@0.14.11
  - @moxxy/client-core@0.10.2
  - @moxxy/client-platform-web@0.1.29
  - @moxxy/desktop-host@0.8.4
  - @moxxy/desktop-ipc-contract@0.10.3
  - @moxxy/ipc-server-ws@0.1.28
  - @moxxy/plugin-stt-whisper-codex@0.0.26
  - @moxxy/plugin-vault@0.0.26
  - @moxxy/runner@0.2.16
  - @moxxy/workflows-builder@0.1.14

## 0.22.1

### Patch Changes

- 92fecb8: Close the cross-package hardening items deferred from the repo-wide sweep, with
  regression tests:

  - **Bugs:** `countNodes()` recursion → iterative (no RangeError on a deep AST);
    subagent `spawnAll` now settles all children (one child's setup failure no
    longer orphans its siblings); the runner socket path honors `$MOXXY_HOME`; the
    computer-control screenshot tool result is projected as a provider image block
    so the model can actually see screenshots; `MoxxyRequirement.version` narrowed
    to the plugin kind; `CompactorDef.compact` signature aligned; `isFileDiffDisplay`
    validation tightened.
  - **DRY:** `sleepWithAbort` / `nextBackoffMs` extracted into `@moxxy/sdk` (shared by
    the default and goal modes); the isolator shim + broker-op concurrency limiter
    single-sourced in `@moxxy/plugin-security` and applied to both isolators; desktop
    loopback ports hoisted to one module; a shared collab-store helper extracted.
  - **Accessibility / contract:** a global `prefers-reduced-motion` rule for inline
    transitions; real ARIA roles + roving focus + Escape + focus-restore on the
    anonymizer filter dropdown; zod schemas for the collab IPC channels.

- Updated dependencies [92fecb8]
  - @moxxy/cli@0.14.10
  - @moxxy/sdk@0.15.2
  - @moxxy/chat-model@0.3.2
  - @moxxy/client-core@0.10.1
  - @moxxy/client-platform-web@0.1.28
  - @moxxy/desktop-host@0.8.3
  - @moxxy/desktop-ipc-contract@0.10.2
  - @moxxy/ipc-server-ws@0.1.27
  - @moxxy/plugin-channel-mobile@0.1.28
  - @moxxy/plugin-stt-whisper-codex@0.0.25
  - @moxxy/plugin-vault@0.0.25
  - @moxxy/runner@0.2.15
  - @moxxy/workflows-builder@0.1.13

## 0.22.0

### Minor Changes

- e762d40: Desktop apps can send their output back to the active session instead of copy+paste. New shared `sendToSession()` + `composerDraftStore` in `@moxxy/client-core` prefill the chat composer and switch to the chat view for the user to review and send. The built-in document anonymizer gains a **Send to chat** button (opt-in per app via `DesktopAppDef.canSendToSession`, enriched with a context line + redaction count). A forward-looking `session.send` capability (permission + bridge method + client sugar) is added to `@moxxy/desktop-app-sdk` for sandboxed apps; it is renderer-dispatched, and the main-process bridge gate refuses it by design.

### Patch Changes

- 21e0d9b: fix(desktop): send pasted / dropped / browser-capture images to the model

  Images that arrive as bytes — a clipboard paste, a drag-drop, or a
  browser-surface screenshot — are stashed to a temp file under `os.tmpdir()` and
  then ride the same attachment pipeline as a picked file. But `session.runTurn`'s
  provenance gate (`authorizeAttachments`) only trusts paths the native picker
  handed out or paths inside the workspace cwd, and `session.saveImageAttachment`
  — unlike `session.pickAttachment` — never remembered the temp path it wrote. So
  every byte-sourced image was silently dropped at send time (only a `console.warn`
  in the main process) and the prompt reached the model as text only. This was a
  regression: the provenance gate, added in the PR right after the chat
  image-paste feature, never vouched for the paste/capture path.

  `session.saveImageAttachment` now remembers the temp path it creates, mirroring
  `session.pickAttachment`, so pasted / dropped / captured images survive the gate
  and actually reach the model.

- e762d40: Repo-wide worst-case hardening (audit-driven). A pessimistic re-audit of every
  package/app scored security, performance, code-quality, extensibility (+a11y on
  UI surfaces) and cataloged 757 findings; this resolves the high+medium+clear-low
  set with regression tests for the failure paths. Highlights:

  - **Security:** email-detector ReDoS made linear (bounded local-part + label
    count + windowed scan); IPv4-mapped-IPv6 SSRF bypass closed; `memory_*` and
    workflow `runId` path-traversal sanitized; cross-host redirects no longer
    replay `Authorization`/body; webhook filter-regex ReDoS bounded; capability
    isolation now also covers tools registered after `onInit`; recursive subagent
    fan-out capped.
  - **Robustness (no happy-path assumptions):** unbounded child/stdout/socket/grep
    buffers bounded (OOM); missing `'error'` listeners + per-call timeouts + abort
    wiring added across the WS transport, runner JSON-RPC, isolators, browser
    sidecar, MCP boot, and provider streams; stale-name/out-of-order resolves,
    malformed-JSON tool input, and corrupt on-disk caches now degrade instead of
    crashing.
  - **Accessibility:** real focus traps + focus restoration + ARIA/`aria-modal` +
    keyboard navigation + Escape across desktop modals/sheets, the shared
    `desktop-ui` Modal, the workflow canvas, and the TUI.
  - **Quality:** dead code removed (incl. the committed `apps/docs/.astro` cache),
    per-workflow schedule-sync isolation, scheduler invalid-timezone resilience,
    and worst-case regression tests throughout.

- Updated dependencies [e762d40]
- Updated dependencies [e762d40]
  - @moxxy/client-core@0.10.0
  - @moxxy/desktop-host@0.8.2
  - @moxxy/cli@0.14.9
  - @moxxy/sdk@0.15.1
  - @moxxy/client-platform-web@0.1.27
  - @moxxy/chat-model@0.3.1
  - @moxxy/desktop-ipc-contract@0.10.1
  - @moxxy/ipc-server-ws@0.1.26
  - @moxxy/plugin-channel-mobile@0.1.27
  - @moxxy/plugin-stt-whisper-codex@0.0.24
  - @moxxy/plugin-vault@0.0.24
  - @moxxy/runner@0.2.14
  - @moxxy/workflows-builder@0.1.12

## 0.21.0

### Minor Changes

- 797f643: feat(anonymizer): region-aware PII dictionary (PL/UK/US) + multilingual on-device NER

  The document anonymizer now _really_ anonymises across markets instead of only
  catching a handful of English-shaped patterns.

  **Engine (`@moxxy/anonymizer`, still pure + offline + zero-dependency):**

  - A `DICTIONARY` of 47 checksum-backed detectors assembled from official sources
    and adversarially verified, grouped by market:
    - **Poland** — PESEL (checksum + embedded birth-date), NIP, REGON, dowód
      osobisty, passport, NRB bank account (mod-97), driving licence, vehicle reg.
    - **UK** — National Insurance Number, NHS number, UTR, postcode (BS7666),
      passport, driving licence, sort code.
    - **US** — SSN, ITIN, EIN, Medicare MBI, ABA routing, bank account, passport,
      ZIP.
    - **Global** — credit card, IBAN (+ per-country length), IMEI, VIN, BTC/ETH
      wallets, and leaked secrets (AWS / GitHub / Stripe / Google / Slack / OpenAI
      keys, JWTs, PEM private keys).
  - New `PiiCategory` buckets (`taxId`, `healthId`, `passport`, `driverLicense`,
    `postalCode`, `bankAccount`, `crypto`, `deviceId`, `vehicleId`, `secret`) and a
    `Region` axis; `detect`/`redact` gain `regions` and `detectorIds` options.
    Spans carry a `subtype` so output is specific (`[PESEL]`, `[NHS]`).
  - Precision contract: the validator (checksum) is the primary lever; bare-numeric
    / no-checksum identifiers are context-keyword-gated; weighted-mod validators
    reject the degenerate all-zeros run.

  **Desktop app:**

  - A **Markets** selector (PL/UK/US; global always on) so a market's ID formats
    can be scoped without false positives from the others.
  - The on-device NER model is swapped from English-only `Xenova/bert-base-NER` to
    multilingual `tjruesch/xlm-roberta-base-ner-hrl-onnx`, so names are detected in
    Polish and other languages (download ~110 MB → ~300 MB). The span aggregator
    was made robust to SentencePiece sub-words so agglutinated names (e.g. Polish
    surnames) are recovered rather than leaked.
  - Redaction-mode hints now state honestly that only `label` approaches true
    anonymisation, while `pseudonym`/`hash` are pseudonymisation (still personal
    data under GDPR).

## 0.20.1

### Patch Changes

- Updated dependencies [0daee68]
  - @moxxy/cli@0.14.8

## 0.20.0

### Minor Changes

- 668bd96: Desktop apps can send their output back to the active session instead of copy+paste. New shared `sendToSession()` + `composerDraftStore` in `@moxxy/client-core` prefill the chat composer and switch to the chat view for the user to review and send. The built-in document anonymizer gains a **Send to chat** button (opt-in per app via `DesktopAppDef.canSendToSession`, enriched with a context line + redaction count). A forward-looking `session.send` capability (permission + bridge method + client sugar) is added to `@moxxy/desktop-app-sdk` for sandboxed apps; it is renderer-dispatched, and the main-process bridge gate refuses it by design.

### Patch Changes

- Updated dependencies [668bd96]
  - @moxxy/client-core@0.9.0
  - @moxxy/desktop-host@0.8.1
  - @moxxy/client-platform-web@0.1.26
  - @moxxy/cli@0.14.7

## 0.19.1

### Patch Changes

- Updated dependencies [d71bf6f]
  - @moxxy/cli@0.14.7

## 0.19.0

### Minor Changes

- 917a700: feat(desktop): redesign the Collaborate feed + task details, deliverables, message cards

  The Collaborate tab showed the team's messages as flat monospace rows
  (`agent → all · subject: body`) and gave no way to inspect a task or see what
  the run produced. Redesigned for observability:

  - **Message cards.** Each message is now a card with a coloured author chip
    (human vs agent), a kind chip derived from the subject (kickoff / progress /
    done / blocked / directive), a broadcast-vs-DM tag (`📣 all` vs `→ agent`), a
    timestamp, and the body — so a long run reads like a team channel, and direct
    messages are visually distinct from broadcasts.
  - **Tasks → modal.** Task-board rows are clickable and open a modal with status,
    owner, detail, and the files the item covers.
  - **Deliverables.** A new rail section lists the distinct files the team
    claimed/produced; the task view (`CollabTaskView`) now folds `paths` + `detail`
    from the board stream.

  Adds folding-test coverage for the new task fields.

### Patch Changes

- Updated dependencies [917a700]
  - @moxxy/chat-model@0.3.0
  - @moxxy/cli@0.14.6
  - @moxxy/client-core@0.8.8
  - @moxxy/client-platform-web@0.1.25

## 0.18.0

### Minor Changes

- f070207: feat(collaborative): run archive/history + an always-available "End & archive"

  Two gaps the user hit: a wedged/finished collaboration couldn't be ended (the
  "＋ New" button only appeared once a run had completed, so a stuck run — or a
  stale single-flight lock — left the Collaborate tab with no way forward), and
  there was no record of past runs at all (the transient run dirs were even left
  orphaned).

  - **Run archive.** Every run is now persisted as a JSON record under
    `~/.moxxy/collab/runs/<runId>.json` on EVERY exit path (completed, aborted,
    failed) — task, brief, roster + per-agent status/summaries, board, contracts,
    merge result, and timings. New `@moxxy/mode-collaborative` archive API
    (`listRunRecords` / `readRunRecord` / `writeRunRecord`).
  - **End & archive.** New `collab.end` IPC aborts the coordinator turn (its
    finally tears the team down + archives) and force-releases the global lock —
    so a stuck run or a stale lock can always be cleared. New
    `forceReleaseCollabLock()` + `SessionDriver.abortActiveTurns()`.
  - **History view.** New `collab.history` IPC + a Collaborate-tab History list
    (outcome, task, agent counts, per-run detail with brief + summaries).
  - The Collaborate header now always offers **End & archive** (while running or
    while a lock is held) and the "already running" banner gained an inline
    "end & archive it now" so a wedged run never blocks a fresh start.

  Adds archive + force-release + abort tests, and the coordinator e2e test now
  asserts the run is archived.

### Patch Changes

- Updated dependencies [f070207]
- Updated dependencies [b226696]
  - @moxxy/desktop-ipc-contract@0.10.0
  - @moxxy/desktop-host@0.8.0
  - @moxxy/cli@0.14.6
  - @moxxy/client-core@0.8.7
  - @moxxy/ipc-server-ws@0.1.25
  - @moxxy/plugin-channel-mobile@0.1.26
  - @moxxy/client-platform-web@0.1.24

## 0.17.2

### Patch Changes

- Updated dependencies [8bc25e7]
  - @moxxy/cli@0.14.5

## 0.17.1

### Patch Changes

- Updated dependencies [a2cb758]
  - @moxxy/cli@0.14.4

## 0.17.0

### Minor Changes

- eb47732: feat(desktop): retire the NDJSON chat store — the runner's log is the sole chat history

  The final step of the dual-history consolidation. The desktop's NDJSON chat
  mirror is fully removed; the renderer reads and writes nothing of its own and
  the runner's authoritative log is the single source of truth for chat history.

  Removed:

  - The renderer's NDJSON read fallback + double-write + per-slot history-source
    selection (`chat-store`), and the legacy localStorage→NDJSON migration. The
    store now pages history solely from the runner (`chat.loadHistory`); with no
    connected runner the transcript is empty until the runner attaches.
  - The `chat.append` / `chat.loadSegment` / `chat.clearLog` / `chat.migrate` IPC
    commands + their validation + remote allow-list entries, the desktop host's
    `chat-log` NDJSON store, the runner-pool/startup seed-migrations, and the now
    unused `@moxxy/core` `seedSessionLog`. Only `chat.loadHistory` remains.
  - "Clear conversation" / session deletion now reset/erase only the runner's log
    (`session.newSession` / `deleteSession`).

  Legacy chats whose history lived ONLY in the old NDJSON mirror are intentionally
  not migrated (the prior migration PRs moved opened/started chats into the runner;
  this drops the rest). Active chats are unaffected — the runner has always written
  their log.

## 0.16.0

### Minor Changes

- e8e227a: feat(desktop): eagerly migrate every NDJSON-only chat into the runner log (complete the consolidation)

  Completes the dual-history consolidation: at startup the desktop now eagerly
  migrates EVERY chat whose history still lives only in the NDJSON mirror into the
  runner's authoritative log (`migrateAllChatsToSessions`), not just the ones the
  user happens to open. After this the runner is the single source of truth for ALL
  chats.

  - Fire-and-forget at `registerIpcHandlers` startup; idempotent + best-effort +
    non-destructive (skips chats the runner already owns, leaves the NDJSON files
    intact, one unreadable chat never aborts the rest). The runner pool still seeds
    on open as the per-chat guarantee.

  The NDJSON store is now fully frozen — not written (for v10 runners) and no longer
  the source of truth — but its files + read-fallback code are retained as a safety
  net. Physically deleting them is deliberately left as a later cleanup gated on a
  packaged-desktop live-verify (it is destructive and touches self-update-sensitive
  paths).

- ccf0a6b: feat(desktop): stop the NDJSON double-write for v10 runners; raise FLOOR to v10

  With the runner now authoritative for every chat (it owns the log and legacy
  chats are migrated into it on open), the desktop's NDJSON chat mirror is no
  longer load-bearing — so we stop writing it where the runner is authoritative
  and require a v10 runner.

  - `chat.append` is runtime-gated on the ATTACHED runner's protocol version (not
    the baked FLOOR, so it stays correct when a JS hot-update outruns the bundled
    CLI): a v10+ runner owns the authoritative log, so the NDJSON mirror is
    skipped; a `<v10` runner (or an unknown version) still writes it so the
    renderer's NDJSON fallback never loses an event.
  - `FLOOR_RUNNER_PROTOCOL` raised 9 → 10 (== `RUNNER_PROTOCOL_VERSION`): the
    dual-history transition is complete, so the desktop drops `<v10` runner support
    and v10 JS hot-updates can apply on fresh installs. The release/floor guard
    (`FLOOR <= RUNNER`) is unchanged.

  The NDJSON store is left on disk as a frozen read fallback; physically retiring
  it is the final separate follow-up.

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
  nitpicks and anything behavior-risky were deferred (tracked in `archived backlog`).
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
  consistency/perf clusters) remains tracked in `archived backlog` as the standing
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
  god-file splits, and the long-tail findings) are tracked in `archived backlog` for
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
