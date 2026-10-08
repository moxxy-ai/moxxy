# Desktop design: the messenger look

The desktop app is being redrawn as a messenger. The conversation is the main
thing on screen. Everything else is reachable but out of the way.

This document is the contract for that redesign. It covers the desktop app
only; the mobile app, the TUI and the web channel keep their own look.

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
| Command palette | ⌘K / Ctrl+K, from any view. It lists the same places and the current run's actions. |

Holding ⌘ (Ctrl on Windows and Linux) for a moment writes each control's
shortcut on it, so the keymap can be learnt from the window itself
(`hotkeys/HotkeyHints.tsx`). A control opts in with `data-hotkey="<binding
id>"`; the chord is read from the keymap, and `hotkeys/hint-controls.test.ts`
fails for a name the keymap does not bind. The hints go the moment a second key,
a click or the wheel shows the hold was the start of something else
(`hotkeys/useModifierHeld.ts`), and they do not animate.

No view stands without the sidebar. A view with sections of its own
(Automations, Channels, Extensions, Settings) lists them there; a view with
none (Apps, Collaborate, Mobile) keeps the runs beside it, and picking a run
goes back to the conversation. `shell/views.ts` holds that rule. In any view
other than the runs, the sidebar's head carries a back control. A place that
needs a loaded session (Collaborate, Automations, Apps) is shown disabled, with
the reason, while the session loads.

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
| Tool calls, reasoning, sub-agents | Quiet lines down the left, no wider than a bubble. The ones with a body open in place. |
| Triggers, stops, errors | A note with a short label. |

Under a message sit its time and, for an answer, copy, read aloud and feedback.
That line always takes its height and is shown for the message under the
pointer or holding focus, so revealing it moves nothing. On a touch screen it
is always shown.

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

Files reach the composer four ways: the add menu, the file browser, a paste,
and a drop anywhere on the conversation, which says it will take them while
they are held over it (`chat/useFileDropZone.ts`, `chat/DropVeil.tsx`). A
dropped or pasted file crosses to the host as bytes, never as a path the
renderer names (`session.saveAttachment`). The sizes are one table for the
renderer and the host (`ATTACHMENT_LIMITS` in `@moxxy/desktop-ipc-contract`:
8 MB for an image, 32 MB for another file). A file that cannot be attached is
refused when it is staged, by name and with the reason, in an alert inside the
composer card (`chat/composer/ComposerAlert.tsx`); the rest of the batch stays.

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
| Plan answers | `chat/modes/plan-next.ts` | The plan nothing has followed offers "Implement" and "Run as goal", the one it recommends filled. Each switches the session's mode first and then sends the prompt, so the prompt cannot run as another round of planning. A goal run starts from the default mode, which is where it hands back. They are not offered while a turn runs, while a question waits, or on an older plan. |
| Step note | `chat/modes/ModeNoteLine.tsx` | A phase of the run (goal started, research round, research complete) is one quiet line with a toned dot. |
| Agents | `chat/blocks/SubagentGroupView.tsx` | A fan-out lists its agents as rows: a state light, what the agent is working on, its tool and token counts, and its state. A research agent is named by its question. |

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

### A voice conversation

Voice mode does not change the screen. While it is on, one card sits between
the conversation and the composer, on the composer's measure and of its make
(`voice-call/VoicePresenceRail.tsx`). At rest it is a capsule in the middle of
that measure: the mark, what Moxxy is doing, and dots while a tool runs. Under
the pointer or the keyboard's focus it opens to the full card: the tool at
work on the left, and on the right the microphone as a round icon whose
tooltip says the state it is in, and a pill that ends the call. A call makes no
sound of its own while Moxxy works: the card shows the work, and the only thing
heard is the answer (`voice-call/voice-silence.test.ts`).

| Rule | Why |
|---|---|
| The card is always laid out at full size and cut to the capsule with `clip-path` | Nothing is measured or reflowed while it opens, and the conversation above never moves. |
| It stays open when the call needs the person (an error, a voice to install), on a narrow column, and where there is no hover | A control must never be reachable only by a gesture the device does not have. |
| It closes a moment after the pointer leaves, and opens at once | A pointer that slips off on its way to End does not lose it. |
| Why a call stopped is said once, beside the state, on up to two lines at every width; a reason longer than that, like any line of the card that is cut, gives all of itself in the tooltip (`components/tip/ClippedText.tsx`) | The reason is the one line here that has to be read, and text that is all there needs no tooltip. |
| The phone starts a call and the phone laid down ends one, in the header, the Mini Chat, the focus pill and here | One pair of signs for one pair of actions. |

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
message calls only when the last of them is done. Each has its own desktop
preference, `replySound` and `systemNotifications`, both on by default and
switched in Settings → Preferences → Notifications.

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
in the same package are what the mobile app reads, and the redesign does not
change them.

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
5. **Other views** (done): Settings, Extensions, Automations, Apps, Channels,
   Mobile, Collaborate and onboarding share one kit, and the focus window wears
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
