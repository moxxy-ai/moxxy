# Desktop design: the messenger look

The desktop app is being redrawn as a messenger. The conversation is the main
thing on screen. Everything else is reachable but out of the way.

This document is the contract for that redesign. It covers the desktop app
only; the TUI and the web channel keep their own look.

## Decisions

| Question | Decision |
|---|---|
| Themes | Light and dark, both designed. The Appearance setting keeps working. |
| Accent | The brand's Signal orange. It is the only accent. |
| Chrome colour | Neutral greys with no hue. |
| Typeface | Each platform's own text face (SF Pro, Segoe UI). No bundled webfont. |
| Geometry | Rounded: 4 / 6 / 8 / 12 px, plus rounder bubbles and sheets. |
| Sidebar row | A session. Workspaces are collapsible section headers above their sessions. |
| Other destinations | One account menu at the foot of the sidebar, and the ⌘K / Ctrl+K palette. |
| The mark | One cut-out picture (`public/moxxy-mark.png`, built in `assets/brand/`): a metal ribbon around a dark visor with two lit eyes. It is the same on both themes and never takes a text colour. A loading mark breathes (scale 0.92 and opacity 0.7 over 2.4 s); it does not turn, because the face is not symmetric. The sidebar masthead and the macOS menu bar blink now and then; nothing else does, so the blink stays a sign of life rather than noise. Reduced motion holds every mark still. The menu-bar glyph is drawn from shapes, not cut from the picture: a bubble whose ring of ink holds a clear visor with the two eyes in it, because a 22 px silhouette of the 3D ribbon came out ragged. |

## Layout target

| Area | Target |
|---|---|
| Sidebar | 280 px wide, resizable between 220 and 400 px. It collapses with ⌘B / Ctrl+B. |
| Sidebar row | 54 px high: a 36 px avatar, the name with the time beside it, and a one-line preview. A small badge on the avatar shows the state (working, unread). |
| Header | 40 px, no bottom line: the avatar and name on the left; on the right the model, a voice conversation, focus mode, the work panel and one menu. Search and rename sit in that menu. The run's state shows only when it needs attention. |
| Transcript | Bubbles. The user's are on the right in a contrasting fill, the agent's on the left in the surface fill. Tool activity stays as quiet markers between them. |
| Composer | One rounded card, 48 px when empty: a round add button, the field, and a round voice or send button. |
| Right panel | Closed by default. Files, terminal, browser and diff open in it from a header icon. |
| Motion | 120 to 240 ms, ease-out. A pressed control scales to 0.97. |

## Motion rules

Motion follows Emil Kowalski's design-engineering rules. They apply to every
step of the redesign.

| Rule | In practice |
|---|---|
| Decide whether it should animate at all | Nothing triggered from the keyboard animates: the ⌘K palette, shortcuts and list navigation appear at once. Menus, sheets and panels animate. |
| Use the curves, not the keywords | `--ease-out` for entrances and presses, `--ease-in-out` for things that move across the screen, `--ease-drawer` for panels that slide. Colour and hover changes keep `ease`. Nothing eases in. |
| Stay fast | State changes take `--motion-shift` (160 ms), a press `--motion-press` (120 ms), an overlay `--motion-overlay` (240 ms). No interface animation runs longer than 300 ms. |
| Answer a press | Every pressable control scales to 0.97 while pressed. |
| Enter from somewhere | An entrance starts at `scale(0.96)` with zero opacity, never from `scale(0)`, and never overshoots. A menu grows from its trigger; a modal stays centred. |
| Animate what is cheap | Only `transform` and `opacity` move. Widths, heights and margins do not animate. |
| Leave faster than you arrive | An exit is shorter than its entrance. |
| Hover is for pointers | Hover effects sit behind `@media (hover: hover) and (pointer: fine)`. |
| Respect reduced motion | Movement is removed; opacity and colour changes stay. |

`apps/desktop/src/styles.motion.test.ts` holds the rules that can be checked in
the stylesheet.

## The shell

The window is a sidebar, the conversation, and a work panel. There is no rail.

The sidebar lists the runs in one section per workspace. A run row shows what
the session list knows (name, time of last activity) and what this window knows
(the newest message and whether a turn is running, for conversations it has
open). The session list does not carry a last message, so a run that has not
been opened in this window shows its first prompt if it was renamed, or its
model otherwise.

Every other place is reached two ways, and both read one list,
`apps/desktop/src/shell/navigation/destinations.ts`:

| Way in | Where |
|---|---|
| Account menu | The row at the foot of the sidebar. It lists every place, the command palette and the keyboard shortcuts. |
| Command palette | ⌘K / Ctrl+K, from any view. It lists the same places and the current run's actions, and it finds what is inside a place by its own name. |

The palette searches one index, `shell/navigation/places.ts`: the places above,
every settings section and the options inside it (`settings/sections.ts`), the
kinds of automation, the channels that are set up and the apps that are
installed. Typing "provider", "gpt live", "theme" or "webhook" opens the view
on the section that holds it, so nobody has to remember which view an option
lives in. `shell/navigation/search-places.ts` ranks the matches: the option's
own name first, then its other names. With nothing typed the palette lists the
places only. An option added to a settings section is named in that section's
`finds`, and `shell/navigation/search-places.test.ts` holds the words people
type against the place each one opens.

Settings sections are listed once, in `settings/sections.ts`, and the sidebar,
the pane and the palette all read that list. Settings holds Providers, Voice,
Jev, Vault and Preferences, and opens on Providers. Extensions holds MCP and
Skills.

Holding ⌘ (Ctrl on Windows and Linux) for a moment writes each control's
shortcut on it, so the keymap can be learnt from the window itself
(`hotkeys/HotkeyHints.tsx`). A control opts in with `data-hotkey="<binding
id>"`; the chord is read from the keymap, and `hotkeys/hint-controls.test.ts`
fails for a name the keymap does not bind. The hints go the moment a second key,
a click or the wheel shows the hold was the start of something else
(`hotkeys/useModifierHeld.ts`), and they do not animate.

No view stands without the sidebar. A view with sections of its own
(Automations, Channels, Extensions, Settings) lists them there; a view with
none (Apps) keeps the runs beside it, and picking a run
goes back to the conversation. `shell/views.ts` holds that rule. In any view
other than the runs, the sidebar's head carries a back control. A place that
needs a loaded session (Automations, Apps) is shown disabled, with
the reason, while the session loads.

First run is the one screen with no sidebar, because there is nothing to move
between yet. It is one form on the sidebar's ground: the mark, a card with
"Step n of N" over a line of step marks, and one step at a time
(`onboarding/chrome/Shell.tsx`). A step that can be left for later offers a
quiet "Skip for now" in place of the lit button, so the accent only marks the
way forward. The provider step's picker groups the coding agents (Claude Code,
Codex, OpenCode: they work through their own SDK, on their own sign-in) apart
from the model APIs Moxxy calls itself; `settings.providerCatalog` tags each
entry `agent` or `api`. Skipping the workspace step keeps the built-in Moxxy
workspace, whose folder is `~/Moxxy` (inside `MOXXY_HOME` when that is set):
the app starts its first runner there (`initialRunnerTarget` in
`@moxxy/desktop-host`), and the step says so before the person skips.

Menus are one component, `shell/menu/PopoverMenu.tsx`, positioned by
`shell/menu/usePopover.ts`. A menu opened with the pointer grows from the
control that opened it. A menu opened from the keyboard appears at once.

Tooltips are one layer, `components/tip/TipLayer.tsx`, mounted once at the
root. A control asks for one with `data-tip` (and `data-tip-side` for the side
it prefers). The bubble is drawn over the window, not inside the control, so
no scrolling or clipped container can cut it; it flips to the other side and
shifts along its edge to stay inside the window (`components/tip/placeTip.ts`).
The first one waits 140 ms; moving on to the next control, or reaching one
with Tab, shows it at once with no fade.

## The conversation

A run reads as a messenger conversation, on a 760 px measure centred in the
pane.

| Entry | How it is drawn |
|---|---|
| What the person said | A bubble on the right, filled with the action colour. A prompt over 12 lines opens clamped, with a control that says how many lines it holds. Attachments sit above the bubble. |
| What the agent said | A bubble on the left, in its own neutral tone. Code, tables and quotes inside it are tinted against the bubble, and each has a copy control in its corner (shown for the block under the pointer or holding focus, always on a touch screen). A table copies as tab-separated rows. |
| Tool calls, reasoning, sub-agents | Quiet lines down the left, no wider than a bubble. The ones with a body open in place. Thoughts one after another are one folded "Thinking" line with their count, opening to every thought in order (`groupThinkingNodes` in client-core, `ThinkingGroupView`), so an agent that thinks before every step does not stretch the conversation with a line per thought. The images a tool returned (screenshots an agent looked at, an image file it read) show under its line as a wrapping row of thumbnails drawn like attached images, every one of them, and each opens in the same preview; opening the line shows the text beside them, never an image as text (`chat/blocks/ToolImages.tsx`). |
| A finished turn's work | Once a turn ends, what the agent did on the way to its answer (its comments along the way, thoughts, tool runs, diffs, helpers) folds into one quiet line, "Worked for 4m 12s" with how many steps, and the answer stays under it. Opening the line shows every step as it was drawn, hung off a thin rule. Never folded: the person's messages, "Agent continued", errors, "Stopped", account limits and other notes, answered questions, the list of steps, a mode's card (a plan, a goal's end) and the turn's last message, so the work folds in runs between them, in order; a run of one step stays as it is. The turn still going stays open, so its steps show as they come (`groupWorkNodes` in client-core, `transcriptNodes`, `WorkGroupView`). |
| A helper that outlives its turn | An agent's helper still working when its turn ends keeps its row there, saying "in the background" with the accent light held still (no breathing: that row no longer follows it). What it does after that, up to its answer, is a row of its own where it happens, marked "from the background"; the earlier row is left as it was, so a terminal that froze it and the desktop tell the same story (`chat/blocks/SubagentGroupView.tsx`). |
| An agent's account limit | The limit an agent reports for the person's account, said in one sentence that names the agent, the window and when it resets: "Claude has used 94% of its weekly limit · resets Sat at 08:00". It sits under the effort and fast mode in the Model & usage window (the telemetry in the instrument bar opens it), dim while there is room, amber when nearly used up and red once it is, and leaves by itself when the window resets (`shell/instrument/Telemetry.tsx`, `chat/useAccountLimit.ts`). It is not a line above the message box: that line could not be closed and stood over every message for days. A turn that stopped on it ends with a "Limit" note in the conversation saying the same, in place of the agent's raw error. |
| An agent's CLI | When the CLI behind the active agent connection is missing, older than Moxxy works with, or behind the vendor's latest, one quiet line above the message box says so in the words the terminal uses ("Codex 0.162.1 is out — you have 0.155.1"), with the fix after it (Install, Update). Amber for an update it can live without, red for one it cannot. The amber one can be closed, and stays closed until the vendor publishes another version (`dismissedAgentUpdates` in the desktop prefs); the red one cannot. While the fix runs the line shows what the installer prints (`chat/composer/AgentCliBar.tsx`, `chat/useAgentCliNotice.ts`, the words from `agentCliNotice` in `@moxxy/chat-model`). |
| An agent's list of steps | One card per turn, drawn where the agent first wrote the list and updated in place each time it changes it: a "Steps" head with how many are done, then one row per step with a round mark (green tick done, accent dot in progress, empty ring waiting, struck through when dropped). The calls that changed the list never show as lines of their own; they sit under the card in the turn's activity (`chat/blocks/StepList.tsx`). |
| Triggers, stops, errors | A note with a short label. A turn the agent opened by itself (Claude going on after its background helper finished) is the same note, "Agent continued" with what finished, on every surface: desktop and terminal (`chat/blocks/trigger-meta.ts`). |

Under a message sit its time and, for an answer, copy, read aloud and feedback.
That line always takes its height and is shown for the message under the
pointer or holding focus, so revealing it moves nothing. On a touch screen it
is always shown.

Settings → Voice → Transcription picks where speech becomes text, for the chat
microphone and Voice Mode's Local engine. Cloud is OpenAI over the ChatGPT
login. Local is Whisper turbo on this computer (`@moxxy/plugin-stt-local`,
shipped in the plugin seed). The first time, a dialog asks before anything
downloads and says how big the model is (~1 GB) and that the app stays usable
meanwhile. The main process then fetches the model's three int8 files from
Hugging Face, in parallel and pinned by size and sha256 (`ensureModelFiles` in
`@moxxy/model-fetch`), into `~/.moxxy/models/stt/turbo`, where the plugin finds
them; nothing is unpacked, so it takes about as long as the bytes do. The card
shows a progress bar with Cancel, and since the switch runs in the main process
and reports on `voice.transcription.changed`, the download goes on and shows
again when the person leaves the tab and comes back. After the download the
switch enables the plugin, makes `local-whisper` the transcriber, restarts the
runners and transcribes half a second of silence to load the model, so the
first dictation does not wait. A notice says when Local is ready or why it
could not start (see "Toasts"). A failed or cancelled switch leaves Moxxy on
Cloud; choosing Cloud clears the choice (`local-whisper.ts` in
`@moxxy/desktop-host`, `useTranscriptionSettings` and `TranscriptionSection` in
the desktop).

Read aloud speaks with the voice chosen in Settings → Voice. With Local Piper
(or any voice but Gemini) it reads sentence by sentence, as Voice Mode does.
With Gemini Flash-Lite it sends the whole answer in one request, or in parts
of up to 3,000 characters cut between sentences for a long one, so it does not
spend a request per sentence against Gemini's rate limit. Each part is kept on
disk in `$MOXXY_HOME/cache/speech`, one WAV file per part, named by a hash of
the voice, model, language, pace and text, so hearing it again plays the file
and calls nothing. The store holds 500 MB; a file's modification time is when
it was last heard, and after each new file the ones heard longest ago are
deleted until it fits. A part that cannot be read or saved is synthesized
again; the store never stops speech (`speech-cache.ts` in
`@moxxy/desktop-host`, `useReadAloud` and `read-aloud-parts.ts` in
`@moxxy/client-core`).

When a turn marked "Agent continued" finishes without assistant text, tool
activity or a helper's activity, one neutral note says "The agent finished
without replying." The agent loop records it only after finishing, so live
clients and reopened history show the same note. A stopped turn, an error or
an exhausted account limit already explains the end and gets no extra note.
The terminal and messaging channels use the same wording; the note
does not become an assistant message or get read aloud by a channel.

A link the agent writes to a file on this computer (a `file://` URL or an
absolute path, spaces and all) opens through the host, never in the browser:
the file's own app for a type that only views or plays, otherwise the file
manager (`chat/local-file-link.ts`, `files.open`). A click that cannot open it
leaves a short red "Couldn’t open this file" beside the link, with the reason
under the pointer, instead of doing nothing.

`chat/trace/TraceEntry.tsx` maps an entry's kind to its side and owns the row.
The bubble is drawn by the block inside it (`UserBlock`, `AssistantBlock`).

The composer is one card on the same measure: a round add button, the field, a
dictation button, and a round button that sends. While a turn runs the send
button is Stop, and the field says a new message will queue. Attach, actions,
goal, auto-approve, voice conversation and mode are in the add menu. The
composer says what the next turn will do only when it is not the default: a
mode other than the default one, auto-approve on, or a goal waiting for its
objective. It says it the way a run says its state, as a toned dot and a line
of text (`.status-chip`), never as a filled capsule: amber for what runs
without asking, the accent for a goal. The model is read in the header.

While a turn runs and the agent keeps a list of steps, a thin bar sits above
the composer card and says where it is: "Step 2 of 3" and the step's text, or
how many are done once none is left. Pressing it shows the whole list under it.
It goes when the turn ends (`chat/composer/TurnStepsBar.tsx`,
`chat/useTurnSteps.ts`).

When the agent of an agent connection (Claude, Codex, OpenCode) uses the
person's computer with its own tools, the strip Moxxy's own Computer Use draws
sits at the top of the conversation: "Codex is using your computer", the app it
last named, and Stop, which stops the turn. Moxxy cannot pause that agent or
take over from it, so the strip offers neither. It shows from the agent's first
computer call in the turn until the turn ends, and only while Moxxy's own strip
is not shown (`computer-control/useAgentComputer.ts`, the call recognised by
name in `agentComputerUseOf` of `@moxxy/sdk`).

Files reach the composer four ways: the add menu, the file browser, a paste,
and a drop anywhere on the conversation, which says it will take them while
they are held over it (`chat/useFileDropZone.ts`, `chat/DropVeil.tsx`). A
dropped or pasted file crosses to the host as bytes, never as a path the
renderer names (`session.saveAttachment`). The sizes bound only those bytes
and are one table for the renderer and the host (`ATTACHMENT_LIMITS` in
`@moxxy/desktop-ipc-contract`: 8 MB for an image, 32 MB for another file); the
refusal says that Attach file takes a larger one, because a picked file goes
by its path at any size. A file that cannot be attached is refused when it is
staged, by name and with the reason, in an alert inside the composer card
(`chat/composer/ComposerAlert.tsx`); the rest of the batch stays. Only a folder
or a file that cannot be opened is refused by the host. A file the model cannot
take whole (too large, a scan with no text, an unknown binary) is never dropped
when the prompt is sent: it goes as a note naming its path on disk, so the
agent can open it with its tools.

An attachment in the conversation is drawn from what the runner sends, and the
runner sends a large one by name and size only (`eventForClient` in
`@moxxy/sdk/attachment-payload`), so no history page grows past a few
megabytes however many scans the chat holds. The file chip shows the real size.
An image whose bytes were left out is read back in slices when its thumbnail
is drawn (`chat/attachments/`, `chat.readAttachment`); until then, and if the
read fails, it is drawn as the file chip.

### The slash menu

A slash as the first character of the field opens a menu above it with four
named groups: the modes, the skills, the workflows and the run's actions. Typing narrows it,
the arrows move, Enter or Tab picks, Escape closes it and keeps the draft. It
opens without animation, because it is opened from the keyboard.

| Pick | What it does |
|---|---|
| A mode | Switches the session's mode. Not offered as a change while a turn runs. |
| Goal | Arms a goal: the next message is its objective. |
| A skill | Puts the skill's `@mention` in the field, ready for the rest of the prompt. |
| A workflow | Runs it in this run, through the run's own `/workflows run <name>`, so the result lands in the conversation and a step that needs a reply asks in the question card. Only workflows that are on are listed; the list is read each time the menu opens (`useSlashWorkflows.ts`). Typing `/workflows` reaches the action itself, never a workflow. |
| Auto-approve | Switches it for the session. |
| An action | Runs it. One that needs values opens its form; in the Mini Chat, which has no room for a form, its name stays in the field and the values are typed after it. |

A line typed in full does the same: `/plan <prompt>` and `/goal <objective>`
switch the mode first and then send, `/compact <words>` hands the action its
words, and `/workflows run <name>` runs a workflow. A line that starts with a slash and names none of these (a path) is
sent as written.

`chat/composer/slash/slash-commands.ts` holds what is offered (pure rules),
`useSlashMenu.ts` what a pick does, and `SlashMenu.tsx` draws it. The desktop
composer and the Mini Chat use the same three.

### Modes

Plan, goal and research are drawn with the same pieces as the default mode,
so no mode has a look of its own.

| Piece | Where | Rule |
|---|---|---|
| Name and hint | `chat/modes/mode-meta.ts` | One place says what a mode is called, what it does in one line and what the empty field asks for. A mode it does not know is shown by its id, tidied, with no claim about what it does. |
| Mode chip | `chat/modes/ModeChip.tsx` | In the composer's status row for every mode but the default: "Plan mode · read-only", "Goal mode · unattended", "Research mode". Its × goes back to the default mode. A mode that acts without asking takes the caution tone. |
| Mode menu | the add menu | Each mode by name with its one-line hint under it. |
| Outcome card | `chat/modes/ModeOutcomeCard.tsx` | What a mode hands back (a plan, a finished or paused goal, a research plan, a follow-up round) is a card with a title and its facts as chips, then the text. The signal tool call that precedes it is not drawn unless it failed. |
| Plan answers | `chat/modes/plan-next.ts`, `chat/modes/plan-dismissals.ts` | The plan nothing has followed offers "Implement" and "Run as goal", the one it recommends filled, then "Rewrite" and "Dismiss". Each way on switches the session's mode first and then sends the prompt, so the prompt cannot run as another round of planning. A goal run starts from the default mode, which is where it hands back. "Rewrite" puts a field in place of the answers for what does not fit (Enter sends, Escape goes back) and sends it in plan mode. "Dismiss" puts the answers away and tags the plan "Dismissed"; the agent is not told, and the dismissal is kept in this window's storage because only the desktop draws plan answers. Only the person moves past a plan: the agent saying more after it in the same turn leaves the answers in place, so a second or third plan offers the same four. They are not offered while a turn runs, while a question waits, or on an older plan. |
| Step note | `chat/modes/ModeNoteLine.tsx` | A phase of the run (goal started, research round, research complete) is one quiet line with a toned dot. |
| Agents | `chat/blocks/SubagentGroupView.tsx` | A fan-out lists its agents as rows: a state light, what the agent is working on, its tool and token counts, and its state. A research agent is named by its question. Its one-line summary ("2 agents finished, 1 failed") is `subagentGroupHeader` from `@moxxy/chat-model`, so the terminal says the same words. |

`chat/modes/mode-events.ts` reads the modes' own events out of the run's log
and says which message is an outcome and which event is a note. The desktop
asks for those events with `registerModeEvents()` at start.

### A question that blocks the run

When the runner waits on the person (a tool needs approval, a mode asks which
way to go on, a workflow wants a reply) the question is a card directly above
the composer, on the same measure and of the same make.

One model says what the card holds and one component draws it, for the desktop
and for the focus window alike: `chat/ask/ask-prompt.ts` turns the request into
a title, the text, the call and the answers, and `chat/ask/AskCard.tsx` draws
them. `chat/AskSheet.tsx` adds what only a dialog needs (the focus trap and
Escape); the focus window shows the same card beside the mark or at the head
of the Mini Chat.

What the agent wrote is read as prose. A tool's call is shown whole, never
summarised, in a monospace well that scrolls instead of wrapping
(`chat/ask/tool-call-text.ts`): the person approves exactly what will run. One
answer is filled, the rest are quiet pills, and the one that throws work away
is red. Asking leave to act marks the card amber; asking which way to go on
marks it with the accent. Focus goes to the safe answer, Tab stays inside the
card and Escape gives the safe answer.

### A Question from the agent

When the agent asks the person something (the `ask_user` tool, or a connected
agent's own question) the card sits in the same place and is of the same make,
titled "Question" with the accent mark (`chat/ask/QuestionCard.tsx`, placed by
`chat/QuestionSheet.tsx`). An approval the run is blocked on comes first; the
Question shows once it is answered.

Each question is a group: an optional short header as an accent chip, the
question as prose, the suggested answers as bordered chips (a picked one takes
the accent border and soft fill), and, where the question takes one, a field
for an answer of the person's own. Several questions stack in one card and go
out with one "Send answer". Send stays disabled until every question has an
answer, and its tooltip says which one is missing. A failed send says why in a
red line above it.

A Question blocks no action, so nothing in the card is safe to pick for the
person: no answer is preselected and Escape answers nothing. Focus goes to the
first suggested answer, Tab stays inside the card and ⌘↵ / Ctrl+↵ sends. The
question is read from the conversation's own events (`useQuestion` in
`@moxxy/client-core`), so every client of the conversation shows the same card
and the first answer from any of them closes it everywhere. A chat with an
open Question counts as waiting on the person in the sidebar and the
instrument bar.

An open Question stays visible when another turn becomes active; changing the
active turn alone never hides it. Codex's asynchronous questions appear while
it works. When it finishes after moving past the question, the card closes and
the transcript says "Question closed: the agent went on without an answer."
Writing a new message instead closes the earlier question, releases any turn
blocked on it, and leaves "Question closed: you sent a new message instead."
Stop closes the question with its turn. A final question still waits for an
answer, which reaches Codex before its next step.

The focus window shows the same card, after any approval, beside the mark and
at the head of the Mini Chat (`focus/FocusAskCard.tsx`, read by
`focus/useFocusAsk.ts`). There it is a group, not a dialog: it takes no focus
and no key, and drops the ⌘↵ hint, because the window floats over other work.
Picks and the field work as in the desktop, and Send answer sends. Its frame
is fixed, so the questions scroll inside it and Send stays in view below them.

Once answered, the card goes and the transcript keeps the decision: a quiet
bordered block headed "You answered", each question in muted text (with its
chip) and what the person chose under it in the text colour, their own words
in italics and quotes (`chat/blocks/AnsweredQuestionBlock.tsx`). It reads the
`question-answer` display `ask_user` returns, so it is never folded away like
an ordinary tool row.

### A voice conversation

Voice mode does not change the screen. While it is on, one card sits between
the conversation and the composer, on the composer's measure and of its make
(`voice-call/VoicePresenceRail.tsx`). At rest it is a capsule in the middle of
that measure: the mark, what Moxxy is doing, the microphone, and dots while a
tool runs. Under the pointer or the keyboard's focus it opens to the full card:
the tool at work on the left, and on the right a pill that ends the call. A call makes no
sound of its own while Moxxy works: the card shows the work, and the only thing
heard is the answer (`voice-call/voice-silence.test.ts`).

| Rule | Why |
|---|---|
| The card is always laid out at full size and cut to the capsule with `clip-path` | Nothing is measured or reflowed while it opens, and the conversation above never moves. |
| It stays open when the call needs the person (an error, a voice to install), on a narrow column, and where there is no hover | A control must never be reachable only by a gesture the device does not have. |
| It closes a moment after the pointer leaves, and opens at once | A pointer that slips off on its way to End does not lose it. |
| Why a call stopped is said once, beside the state, on up to two lines at every width; a reason longer than that, like any line of the card that is cut, gives all of itself in the tooltip (`components/tip/ClippedText.tsx`) | The reason is the one line here that has to be read, and text that is all there needs no tooltip. |
| The phone starts a call and the phone laid down ends one, in the header, the Mini Chat, the focus pill and here | One pair of signs for one pair of actions. |
| The microphone is a small round button beside the state, in the capsule, on or off: in the accent while it listens, cut and red while it is off, in every phase ("Speaking", "Thinking", "Working"…). Its tooltip says the state it is in, and while it is off a screen reader hears "…, microphone off" after the state (at rest the state itself reads "Microphone off"). Flipping it, by click or ⌘D, changes the same button in place, with no motion; it stays where it is as the card opens, and there is no microphone on the right. The capsule still hugs its state, so "Listening" becoming "Microphone off" moves it about 19px; its target reaches 24px to each side of its middle, so a second click in the same place still turns it back on | At rest only the capsule shows, so a microphone among the hidden controls could not say it was off while Moxxy thought or spoke. The card opens under the pointer that is already on the microphone, so it must not move away from it, and one place for it, on or off, is one thing to learn. |
| ⌘D / Ctrl+D turns the microphone off and on during a call, in the main window and in Focus Mode, also while typing; it is listed under Voice in the shortcuts sheet (`voice-call/useVoiceMicrophoneShortcut.ts`). Not ⌘M, which macOS keeps for minimizing the window, nor ⌘⇧M, which is Focus Mode | The microphone is the control a call reaches for most; a key reaches it without finding the pointer. |

`apps/desktop/src/styles.conversation.test.ts` holds the drawing rules that can
be checked in the stylesheet.

### A chat that needs you

A chat calls the person back twice: when it finishes its answer, and when it
stops to ask for a decision, which leaves its turn open
(`attention/calls-for-attention.ts`). The chat being read needs nothing. What
any other gets is decided in one place, `attention/attention-plan.ts`:

| Where the person is | The chat that calls | Chime | System banner |
| --- | --- | --- | --- |
| In the main window, reading that chat | the one on screen | no | no |
| In the main window | any other, or the active one while another view is open | yes | no |
| In the Mini Chat | the one it shows | no | no |
| In the Mini Chat | any other | yes | no |
| Elsewhere, the Mini Chat floating beside the work | the one it shows | yes | no: the widget shows it |
| Elsewhere | any | yes | yes |

Only the main process knows which window has the keyboard, so the renderer
asks it (`window.presence`) at the moment a chat calls; a main process that
cannot be asked counts as "in the main window". The chime is two soft notes
made in code (`attention/reply-chime.ts`), so there is no audio file to ship.
The banner is the system's own notification, silent, headed by the chat's name
and carrying the answer's first line or "Waiting for your decision."; a newer
one for the same chat replaces the older, and a click brings the main window
forward on that chat (`attention/show-banner.ts`). A chat removed while it
answered calls for nothing, and an answer followed at once by its queued
message calls only when the last of them is done.

While the main window has the keyboard, a chat that calls also gets a toast in
the top-right corner, under the header bar, with the same words as its banner;
a click opens it.

Each of the three has its own desktop preference, all on by default and
switched in Settings → Preferences → Notifications: `replySound` for the
chime, `inAppToasts` for toasts inside Moxxy and `systemNotifications` for the
system's own notification (macOS, Windows or Linux) while Moxxy is in the
background. Turning one off silences only that one, for chats and for
`app.notice` alike; with toasts off, a notice that arrives while the main
window is in front shows nothing rather than falling back to a system
notification.

### Toasts

A toast is a short note about work that finished while the person was
elsewhere in the app: a chat's answer (above) or work the host ran in the
background, such as the Whisper download. The host sends that work as an
`app.notice` (an id, a tone, a title, words and, optionally, the Settings
section it is about); `notices/useAppNotices.ts` shows it as a toast while the
main window has the keyboard (when in-app toasts are on) and hands it to the
system as a banner otherwise (when system notifications are on). One store holds the toasts
(`notices/toast-store.ts`): at most three, in the top-right corner clear of
the composer, newest at the bottom, a newer one
with the same id replacing the older; they leave on their own after six
seconds, an error after ten. `notices/ToastStack.tsx` draws them.

## The work panel

The terminal, the file browser, the diff and the browser share one panel on the
right. Closed, it draws nothing and takes no room. The run's header has the
button that shows and hides it, and ⌘J / Ctrl+J does the same; both call one
toggle (`shell/useWorkbench.ts`), which reopens the pane that was last in use.
The panel still opens by itself the first time the agent drives its browser or
terminal.

The terminal is drawn on the panel's own background in the palette's colours
(`shell/surfaces/terminal-theme.ts`), and repaints when the theme changes; it
has no frame or colour of its own. It opens with the word Moxxy, set in block
characters two rows high, and one line that says the agent shares it
(`shell/surfaces/terminal-welcome.ts`).

The padding around the terminal belongs to a frame (`.term-pane__host`), never
to the box xterm is mounted in (`.term-pane__mount`): xterm works out its rows
from that box's height, so padding on it adds a row that is cut off at the
bottom.

In zsh and bash the agent's commands appear as typed and nothing else: the
shell reports the end of a command in a control sequence the terminal does not
draw (`packages/plugin-terminal/src/shell-hooks.ts`). Other shells, and
Windows, still show the tool's end marker.

Its width is never animated: the terminal measures its columns when it mounts.
The closed panel stays in the layout at zero width instead of being removed,
because the browser parked inside it has to keep painting to keep its pages.

### Shared media

Media is a fifth pane beside Terminal, Files, Diff and Browser, also found by
name in ⌘K. Five labelled tabs are wider than the strip at the panel's default width, so
below that width an inactive tab is drawn as its icon alone, named by its
tooltip and for assistive tech; the open tab keeps its word, and every tab
stays in view (`@container bench-tabs` in `styles.css`). It belongs to the current chat, including its older history, and
does not open automatically when the agent captures a screen. Its three
sections — Media, Files and Links — use the existing recessed segmented
control. Search and the All / You / Agent sender filter sit below it; changing
chats resets these controls. Typing and switching filters do not animate.

Images form a responsive square grid under quiet month headings. Only visible
tiles and their immediate neighbours request thumbnails. A small spark marks
an agent image without making its tile a different colour. Clicking opens the
existing image preview, with previous/next controls and arrow keys through the
filtered images. File and link rows share one layout: a quiet icon, a truncated
name, then size or host and date. Missing local files say so and cannot open.
Links open as links in the chat do; the library never fetches a page preview.
Empty, loading, search-without-results and read-error states are distinct.

The full log is indexed into a disposable cache per chat that holds no
attachment bytes; an attached file is copied there only when it is opened. Completed messages supply links; code and pages merely visited
by browser tools do not. Repeated images and links appear once. Rebuilding
the cache never rewrites the conversation.

### Agents

Agents is the sixth pane, also found by name in ⌘K ("background work", "helpers"). It lists the times the agent set itself to come back ("Scheduled"), then the chat's helpers and the commands its agent left running, those that run now first (`shell/surfaces/agents`). It is drawn with the Media pane's pieces: the same header with its count, captions in the muted text colour, and rows with the icon on a 32 px tile, the name and one line under it. A state is a dot and a word (an accent dot running, green done, red failed), the way a run says its state. A scheduled wakeup says when the agent comes back and how soon ("Back at 22:59 · in 3 min", or "Next at" for one that repeats), read from Claude's own list of what it set (`SessionInfo.scheduledWakeups`, from its `Stop` hook); Moxxy cannot cancel one, so the row has no control, and the agent cancels it when asked in the chat. Picking one opens its mini chat: a helper's task in a bubble on the right, what it said and the tools it called in order, then its answer; for a command, once it ended, what it printed last (its line is the heading, and the agent's summary shows only when it says more). A running work has Stop; nothing here writes to the agent. Durations count up while something runs and do not animate otherwise. "Show in chat" scrolls the chat to the "Agent continued" entry the work opened, and marks it a moment.

In the chat, "Agent continued" is one chip without a box under it (its prompt is its name). When it says which work ended, clicking it opens that work here; a turn the agent woke itself up for reads "Agent continued · Scheduled check-in". Above the message box, drawn as the steps bar is (the lead in the text colour, the rest muted, 18 px), one quiet line says what runs in the background ("In the background npm run dev") and another when the agent comes back by itself (a clock, "Back at 22:59 · in 3 min", what for, and how many more are set); each opens this pane. The running dot breathes in opacity the way the mark does and holds still under reduced motion. The pane does not open by itself.

No control or note draws a text glyph or an emoji for an icon (✕, ⚠, ✓, ⛶, 📣): they come from the one icon set, `Icon` in `@moxxy/desktop-ui`, so their weight and size match the rest. The terminal, Telegram and Discord, which have no icons, keep their characters.

## The other views

Every view outside the conversation is built from one small kit, so they read
as the same app.

| Piece | Where | Rule |
|---|---|---|
| Labels | everywhere | Sentence case. No label is set in capitals or tracked out; `styles.type.test.ts` holds that for the stylesheet and for inline styles. |
| Sidebar row | `IndexRow` in `shell/IndexColumn.tsx` | One row for a settings section, an automation or a channel: the run row's fill when open, an optional icon, state light and note. A settings section always has its icon. |
| Sidebar caption | `IndexGroup` in `shell/IndexColumn.tsx` | A caption over a group of rows is small and dim, with no icon, so it never reads as a row. A list whose groups each hold one row draws no captions. |
| State chip | `.tag`, `components/StateToggle.tsx` | A state is a word in a filled pill, toned good, bad or warn. The chip that switches a workflow, schedule or webhook on is the same chip. |
| Table | `.data-table`, `.data-row` | Fixed tracks for the trailing columns, so a head sits over its cells. |
| Approvals | `workflows/WorkflowApprovals.tsx` | Shown only while a workflow waits on the person. |
| Provider groups | `CardGroup` in `settings/settings-primitives.tsx` | Providers is two lists, not one: "Coding agents" (the agent on this computer does the work, on its own sign-in) above "Model providers" (Moxxy does the work and calls the model, with an API key or a sign-in). Each has a quiet heading with its count and one line on what sets it apart; a hairline and 20 px of air sit between them, so the split reads before any row does. A kind with no rows shows no heading. No motion: it is a list. |
| Model picker providers | `chat/agent-picker/ProviderModelGrid.tsx`, `useConnectedProviders.ts` | The provider column of the model picker (Model & usage, and a channel's model) lists only the providers Settings → Providers shows as connected — an agent installed and signed in, a provider whose key resolved, a local server that answers — read from the same `settings.providers` answer through `isProviderConnected` in `@moxxy/client-core`, so the two never disagree. The running provider always stays. It splits them the way Providers does: "Coding agents" above "Model providers", each under a quiet heading, a kind with none showing no heading. Until Settings answers only the running provider shows, so a list never grows and then shrinks under the pointer; when Settings cannot answer, every provider shows rather than none. |
| Agent connection | `settings/agents/AgentConnectionRow.tsx` | Claude, Codex and OpenCode each get a row in the "Coding agents" group at the head of Providers, and the same row in the first-run provider step: the agent's name with its state as a chip beside it (so the line under the name has the whole width and stays one line), one line under it (the account it is signed in to and the version, or what is wrong), the one action that moves it on (Install, Update, Sign in, Check again) and a menu with "Check for updates". While its CLI installs or updates, a thin bar under the line fills as the installer reports a percentage, or slides while it says none. The state comes from the runner (`ProviderEntry.agentCli`) and from the install this window runs (`agentConnectionView` in `@moxxy/client-core`). |

### The focus window

The focus window is the desktop continued in a small window, not a second
design. It is its own document, so it repeats the palette
(`focus/focus-styles.ts`), and `focus/focus-look.test.ts` fails when that copy
and `styles.css` disagree.

| Piece | Rule |
|---|---|
| Mini Chat | The same `Transcript`, mode cards and plan answers included (`registerModeEvents()` runs here too), in a rounded card. |
| Header | Back on the left, the mark in the middle, and on the right the voice conversation and the main window, in equal columns so the mark stays centred. The voice button is the desktop header's: a phone, "Voice conversation", lit with the accent and named "End voice conversation" while a call is on. A call started here is held here; the mark then shows what Moxxy is doing. It is absent where a conversation cannot be held. During a call the phone is laid down, here and on the pill. |
| Composer | The desktop composer's card, field, slash menu and send button (`.cmdbar__card`, `SlashMenu`, `SendButton`): Stop while a turn runs, and Enter queues. The add menu and dictation are left out. Files dropped on the Mini Chat are attached by the desktop's rules, with the same alert. |
| What the next turn does | The mode chip and "Auto-approve on" above the field, read from the session (`focus/useFocusSessionState.ts`), so a switch made on the desktop, in the TUI or by a bot shows here. |
| Placeholder | One rule for both composers (`chat/composer/composer-placeholder.ts`). |
| Questions | The same card as the desktop (see "A question that blocks the run"). |
| Reply bubble | One plain line, by the rule the run list uses (`lib/plain-line.ts`). |
| Tooltips | The same layer, mounted in `focus/focus-main.tsx`. |

## Where the values live

The desktop has its own palette pair, `desktopTokens` and `desktopDarkTokens`,
in `packages/design-tokens/src/desktop.ts`. The shared `tokens` and `darkTokens`
in the same package are the framework-neutral default, and the redesign does
not change them.

Both desktop palettes keep the shared token shape, so every CSS variable the
renderer already reads keeps resolving. `apps/desktop/src/styles.css` declares
those variables, and a parity test in the design-tokens package fails when the
stylesheet and the palette disagree. The same package tests colour contrast for
every palette against WCAG 2.1.

## Reference and licence

The target look was measured from OpenBot, which is published under the
PolyForm Noncommercial licence. Moxxy is MIT. No OpenBot code, stylesheet,
avatar or logo is copied into this repository. The layout and the measurements
above are reimplemented here in Moxxy's own components.

## Steps

1. **Foundation** (done): palette, typeface, radii, type scale and motion.
2. **Shell** (done): the rail is gone, the sidebar is a run list, the account
   menu and the palette lead everywhere else, and the header is lower.
   `PRODUCT.md` changed in the same step, because it names the desktop's
   primary navigation.
3. **Conversation** (done): bubbles, quiet work lines and the one-card
   composer.
4. **Right panel** (done): the work panel is gone while closed and opens from
   the run's header.
5. **Other views** (done): Settings, Extensions, Automations, Apps, Channels
   and onboarding share one kit, and the focus window wears
   the desktop palette.
6. **Review pass** (done): voice and focus mode on the header, one tooltip
   layer that is never clipped, settings sections with icons, plan, goal and
   research drawn with the conversation's own pieces, the blocking question as
   a card, and copy on quotes, code and tables.
7. **One app in every window** (done): the focus window uses the desktop's
   composer, question card and tooltips; the question shows the whole tool
   call; voice mode is a card above the composer; the terminal takes the
   palette; a finished plan offers to be carried out.
8. **In reach of the keyboard** (done): a slash menu for modes, skills,
   workflows and actions in both composers; the next turn's state as a dot and a line; a
   voice button in the Mini Chat header; the terminal greets with the mark,
   keeps its last row in view and no longer shows the agent's end marker.
9. **Found by name** (done): the palette finds every option by its own name
   and opens the section that holds it; Providers are the first section of
   Settings; first run is one form with no sidebar.
