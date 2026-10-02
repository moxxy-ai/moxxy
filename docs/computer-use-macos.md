# macOS Computer Use

Moxxy's macOS extension owns its native backend: a Swift helper
(`moxxy-computer`, universal arm64 + x86_64, macOS 14+) started as a child of
the host. It does not load Codex, `@oai/sky` or `@oai/cua`, and links no private
framework at build time (one route for background pointer input is looked up
at run time, see below). It speaks helper protocol v5, the same contract as the Windows
helper, so the model sees one set of tools on both systems (see
[`computer-use-rebuild/README.md`](computer-use-rebuild/README.md)).

## Operating contract

- Every operation uses the tool permission pipeline, and an app must be granted
  with `computer_request_access` before it is observed or operated. Browsers
  default to read-only and terminals to click-only. UI text is untrusted.
- An app is addressed by its bundle identifier. A request may also name it by
  the name the system shows (which may be translated, such as "Kalkulator"), by
  the name of its bundle ("Calculator"), or by its path. An app installed
  outside the application folders is found by identifier or path, or by name
  while it runs.
- `computer_get_app_state` starts an app that is not running, without bringing
  it forward, and waits for it to settle (accessibility events, up to 5 s). It
  returns the focused window's accessibility elements, each with an
  `element_index`, and a JPEG of the window. An index stays with its element for
  as long as the element lives. Password fields are listed without a value.
- An app with no open window returns an empty state and says so. Keys still
  reach it, so `super+n` or `super+o` can open a window.
- Actions take an `element_index` or a point of the latest screenshot. When a
  call names both, a real point is the target and a `0,0` point is ignored.
  Element actions go through accessibility and work while the app is in the
  background; the user's pointer does not move.
- A click, drag or scroll with no accessibility equivalent (a canvas, a
  timeline) is first sent to the app's window in the background: the app in
  front keeps the focus and the pointer stays with the user. This uses
  window-server calls that Apple does not document (`SLEventPostToPid` and
  related, looked up at run time), left button only.
- Real input is the fallback. It is used when those calls are missing, when the
  window is not on the current screen, for the right and middle buttons, when
  the window and its elements show no change within 0.6 s, and when the model
  asks for the same gesture again. The app comes forward, the helper checks the
  point (on screen, inside the target app, not Moxxy's own window, pixels
  unchanged since the screenshot), acts and puts the pointer back. The helper's
  result records the route (`ax`, `background` or `input`); the model is not
  shown it.
- A window on another Space that cannot be captured, or is captured black, is
  brought to the current screen and captured again. A window on the current
  screen is captured through its display, so the picture shows it where clicks
  land; a window the system list misses for a moment is looked up again.
- Command shortcuts are menu key equivalents, so the app is brought forward for
  them. The helper never does that while the user is typing.
- An app comes forward through accessibility first. A window that stays away
  after 0.4 s (one in its own full-screen Space does) is brought through the
  workspace, which switches to its Space.
- Every action returns `delivered | ineffective | unsupported | blocked` and the
  fresh state. `delivered` is not evidence that the task succeeded. The same
  action leaving the same state twice ends as `ineffective` with `no_progress`
  and the next method to try.
- A control that accepts an accessibility press and does nothing (Qt buttons)
  gets a real click when the same action is asked for again. If that changes
  nothing either, the result is `ineffective` and a third try is not sent.
- A focused field that sits outside the window (Finder's rename field) is part
  of the state. Typing into an element that takes no text is refused.
- Text typed through accessibility is checked: when the field and its caret stay
  as they were (Chromium apps), the text is sent as keys instead.
- The helper switches on an app's full accessibility tree
  (`AXEnhancedUserInterface`, `AXManualAccessibility`) the first time it looks
  at the app, and switches off what it changed when it leaves.
- Inside a web page the tree leaves out what repeats: the context menu every
  element offers, empty groups, and a node that only says its parent's name
  (a link inside a link, a link's own text).
- For a browser, the state is read once the page content is there (up to
  about 3 s). A page that still does not show gets its window brought forward
  once and is read again; only then does the result say the page is not
  readable. A window with no page (the start page) is not waited for.
- A save dialog aimed at a protected place (`~/.ssh`, LaunchAgents, shell
  startup files, git hooks) is refused.
- An open or save panel is drawn by a system service inside the app's window;
  a click on a file in it counts as a click on the app.
- With the first state of an open or save panel in a turn the model gets a
  note: choose the file with `super+shift+g`, the full path and Return, then
  press the panel's confirm button; the search field is not to be used.
- A window the app draws itself, with no elements below its title bar (Blender,
  a game), gets real clicks only: such apps read the pointer from the system,
  so a click sent in the background would land under the user's pointer.
  Before keys go to such a window, the app is told the pointer is where the
  last click went, because it sends keys to the editor under the pointer. Text
  typed there goes key by key, one character per key event.
- A shortcut with modifiers (`shift+a`, `super+z`) presses the modifier keys
  themselves around the key, the way a hand does: Blender follows the modifier
  keys and takes a flag on the letter alone as the bare letter.
- Blender has its own notes (`skills/computer-apps/blender.md`): commands by
  name through `F3`, shortcuts instead of the small header menus.
- Escape stops the turn. Input from the user pauses the agent; an action waits
  for a quiet moment before using real input. "Take over" releases held input
  and hides the agent's cursor.
- The agent's cursor is a click-through panel above the target window, kept out
  of screenshots. The live view in the desktop chat is a separate stream (H.264
  at 30 pictures a second, or JPEG at 2 for a viewer without a video decoder)
  that never reaches the model or the session log.

Not supported: controlling a window on another Space without bringing it here,
and apps that refuse both accessibility and synthetic input.

## Runs of steps (`computer_run`)

`computer_run({ app, goal, steps })` carries out up to 30 steps in one tool
call. A step is `click`, `type`, `set_value`, `key` or `scroll`; it names its
control in words (`target`) and may say what the window shows afterwards
(`expect`). The code is in `src/jev/` and is the same on macOS, Windows and
Linux; only the helper underneath differs.

- **Who decides what.** The main model writes the plan. Jev (TypeSafe System
  One, `jev-latest`) answers two kinds of question about the live element
  tree: which element a step means (a Choice over the elements, with "none"),
  and whether what `expect` describes shows (a Noul). Code does the rest:
  it picks the way to act, and the next way when one fails (element action,
  then a click at the element's centre; `type_text` on the element, then click
  and type; `set_value`, then click, select all, type), up to four ways per
  step.
- **One request per step.** The check of a step and the search for the next
  step's element go in one request (about 0.3 s for 150–250 elements).
- **Where it stops.** At the first step it cannot do: no element matches, the
  expectation does not show after every way, or the helper refuses (user took
  over, access level, protected path). The report lists each step, the element
  used, and the closest elements when none matched, followed by the fresh
  state. Steps without `expect` are reported as delivered, not verified.
- **Key.** The secret `TYPESAFE_API_KEY` from the vault (`/vault set
  TYPESAFE_API_KEY`), or the environment variable of the same name. The tool
  may reach only `api.typesafe.ai`.
- **Without a key** Computer Use works as before: `computer_run` is taken out
  of the tools the model is offered and the rules do not mention it. A key in
  the environment counts from the first request; a key in the vault is seen at
  the session's first `computer_*` call. If the tool is called anyway, it
  answers with the state and a note, not an error. A request to Jev that fails
  (network, a wrong key) ends the run at that step with the reason and the
  fresh state.
- **Learning.** What runs teach is kept per app in
  `~/.moxxy/computer-use/learned/<app>.json` (`src/jev/memory.ts`), on this
  computer only:
  - for every verified step: the target's words, the element (its key and
    label), the way that worked, and the named elements that appeared;
  - a step the run could not do, when the model then does it with a single
    tool on an element and the window changes: that element;
  - every run that reached its end with a verified step, as a route (goal and
    steps). The five most used routes are shown to the model with the app's
    first state of a turn, to be sent again unchanged.

  Lessons are read in this order: what ships with moxxy
  (`packages/plugin-computer-control/learned/`), then this computer's own
  file, then Jev for what neither has. The shipped files are filled by the
  moxxy team: run cases on a real machine, then `pnpm --filter
  @moxxy/plugin-computer-control learned:promote` and commit the diff. Of a
  step's effect only labels that repeat the element's own name are shipped
  (the rest can be the trainer's networks, devices and files); the user's
  computer completes it at first use. A shipped target that proves wrong on a
  computer is ignored there from then on. Elements are matched by role and
  title as the system shows them, so shipped lessons help only in the
  language they were learned in (today: System Settings, macOS in Polish).
  Words of a target are compared without case, punctuation, articles and
  "in/on/at/of/to/item".

  The next time a step has the same words, its element is taken from memory
  when the window still has it under the same label, and the step counts as
  verified when the same elements appear, so a repeated step asks Jev
  nothing. When what appears differs, Jev checks the step; when the
  remembered element does not do it, Jev is asked for the element and the
  memory is corrected. At most 200 targets and 20 routes per app. Jev itself
  is not trained; nothing of this is sent anywhere.
- **What leaves the computer.** Per request: the goal, the step, the app and
  window names, and the text lines of the window's elements (roles, titles,
  values; never the value of a secure field). No screenshot is sent.
- **Limits.** A window with more than 1000 elements is not searched. Targets
  that exist only in the picture (canvases, timelines) have no element; use
  the single tools with `x` and `y` there.

Measured on System Settings (Polish), three clicks with `expect`: 3 of 3
verified, 4 Jev requests, 7.5 s; before the helper changes below it was 24.1 s.
The same plan again, from memory: 0 Jev requests, 4.0 s (two clicks; the third
step's result already showed).

### Time per action

After an action the helper waits for the app to settle, then reads the tree
and takes the picture. What it waits for:

- at least 1 s from the moment the input went out when the app sends no
  change notification, 0.4 s once it has sent one, then 0.3 s without
  changes; time the action itself took counts;
- a spinner holds the wait only while something else changes too: 1.5 s
  without other changes ends it (the Bluetooth pane spins for as long as it is
  open); 5 s is the limit in every case;
- notifications that the helper's own reading of the window causes (System
  Settings destroys the elements it made to answer) are not counted.

Browsers: Safari first answers with a tab's empty containers and the page
comes seconds later; that counts as a page not readable yet, so the helper
reads again (up to 8 times, 0.4 s apart). Typing into a field of a page works
while Safari stays in the background: the app names no focused element then,
so the field's own focus counts.

A plain click on the text, picture or cell of a list row selects the row
through accessibility: no pointer, no cursor glide, and it reaches rows
scrolled out of view (the lower panes of System Settings). Such rows exist
only for the moment they are read, so the helper finds the element again by
what it reads and acts at once.

Other cuts: all attributes of an element are read in one message (tree of 150
elements: 0.27 s → 0.14 s); the read that finds the window quiet is the state
(no second read); a native app is not given a second to build its tree at the
first look (only browsers and Electron apps are); after an action whose effect
was already seen, the wait is one quiet spell; when a step's result does not
show, `computer_run` looks once more before it tries another way.

Measured on System Settings (25 single-step runs, each with a fresh look, the
click and the check): first time with Jev 1.4–1.9 s (two slow panes 2.6–3.0 s);
again from memory 0.8–1.2 s with no request to Jev. An action with its fresh
state through the helper: 0.8–1.1 s. `MOXXY_COMPUTER_TIMING=<file>` makes the
helper write where each request's time went.

In a source list whose cell offers "open" itself (Finder's sidebar), a click
on the row performs that action: selecting the row there only highlights it.
A file row's cell has no such action, so one click still selects.

A long web page cannot push the window's own controls out of the state: the
reader keeps 500 of its 4000 nodes for what follows the page, and the page
gets what the other elements leave of the 1000 listed (Safari lists its
toolbar after the page). What Jev reads is fitted to its input limit by
shortening what elements say (300 → 120 → 60 → 30 → 12 characters) until the
window is under 30 000 characters; every element stays listed.

The model words a target its own way ("panel Ogólne na pasku bocznym", "the
Tapeta item in the System Settings sidebar"), so a lesson rarely matches word
for word. When exactly one lesson's element name stands in the target as
words of its own, that lesson is a guess; one request to Jev at the start of
the run asks about all guesses at once, and a confirmed guess runs from
memory and is then remembered under the new wording too.

The rules tell the model that `computer_run` looks at the window itself: after
`computer_request_access` it goes straight to `computer_run`, without
`computer_list_apps` or `computer_get_app_state`. An app may be named in later
calls the way it was asked for ("System Settings"), not only the way the
system names it ("Ustawienia systemowe").

A remembered step is sent to the helper with what it showed last time
(`until`). The helper reads the window every 30 ms after the action and
returns the moment those elements are there, instead of waiting for the app
to go quiet (up to 1.2 s, then the usual wait). A key pressed for a result
(`expect`) is remembered by the key and that expectation, as what it made
appear; that lesson stays on the computer. Measured, all without a request to
Jev: five System Settings panes in one run 5.9 s → 2.5 s; one remembered click
with its first look 0.4–0.8 s; Safari address and Return 2.6 s → 1.5–1.8 s;
Finder new window from the desktop and a sidebar place 3.2 s → 1.4 s.

A remembered step is taken for done without asking only when what it showed
last time is there again and its element (or the row or cell around it) is
the selected or checked one. Otherwise the look of the window may be a
look-alike ("new tab" on a start page), so Jev is asked, and what already
showed before the step does not count as its proof.

Finder with no window open is observed through its desktop. The desktop is
not brought forward as a window: the app alone comes forward. When an action
opens another window (a new one from the desktop, a dialog), that window is
the state the action returns.

A step that checks nothing itself (typing into a field) is remembered when a
later step of the same run was seen to work. An element with no title is
known by its description (toolbar buttons).

Shipped lessons now cover System Settings, Finder (ten sidebar places) and
Safari (toolbar buttons, the address field), all for macOS in Polish.

The helper listens to the app from before each action, so a reaction that
comes while a key or text is still going out is heard, and the wait after it
is the quiet spell, not a full second. A browser that already has its page in
the accessibility tree is not given a second to build it at the first look.
Measured in Safari with Jev: new tab, address, Return (checked) 4.7 s → 3.7 s;
type into a page's search field, Return (checked) 16.5 s at first → 4.8 s, of
which about 1.8 s is the page loading.

A background click reads the window once before it is sent (not twice), uses
what the last observation said instead of reading the tree again, and the
cursor glide takes 0.1–0.25 s. A click in System Settings with its fresh state
takes about 1.9 s (5.5–7.2 s before).

## Permissions

The helper needs Accessibility and Screen Recording. Both belong to the app
that starts it: Moxxy.app in the desktop, the terminal in the CLI.
`computer_status` reports what is missing and can open the right settings pane.

## Build and test

```sh
cd packages/plugin-computer-control/native/macos
./build.sh                               # bin/darwin-universal/moxxy-computer + manifest
./Tests/run-computer-use-tests.sh --wait-idle
```

The script runs the Swift unit tests, builds the helper and the fixture app,
then runs the end-to-end tests, which drive the real helper against the
fixture. Those use the real pointer and keyboard for a few seconds at a time, so
leave the mouse and keyboard alone; `--wait-idle` starts them after 20 s
without input. `--filter=<pattern>` runs matching tests only.

## Fixture app

`Sources/ComputerUseFixture` builds `MoxxyComputerFixture.app`
(`ai.moxxy.computer-fixture`). Each part exists for one behaviour:

| Part | What it tests |
|---|---|
| Name field, Press button, status label | element actions in the background |
| Secret field | a password value is never read |
| "Loaded" label | content that appears after a delay (settling) |
| Disabled button | a control that cannot be pressed |
| Save… button | a save dialog, and the guard on protected places |
| Shift button | the layout moves; indices stay with their elements |
| Dud button | a control with no effect ends as `no_progress` |
| Stubborn button | ignores an accessibility press, counts real clicks |
| Deaf field | accepts text set through accessibility and drops it; only keys type |
| Pad | points, buttons, scrolling, drags on a view without elements |
| Timeline | clips A and B on a canvas without elements: drag moves, right-edge drag trims |
| Menu: Press Again, New Window, Close Window | Command shortcuts, and an app with no window |

## Trying it in Moxxy

```sh
node packages/cli/dist/bin.js --model gpt-6-luna -p "Use Computer Use on Calculator: compute 17 times 23." \
  --allow-tools computer_status,computer_list_apps,computer_request_access,computer_get_app_state,computer_click,computer_press_key
```

The CLI prefers a copy of the plugin under `~/.moxxy/plugins` over the one in
the workspace, so an older installed copy hides local changes.

Results of the trials and the benchmark are in
[`computer-use-rebuild/benchmark.md`](computer-use-rebuild/benchmark.md).
