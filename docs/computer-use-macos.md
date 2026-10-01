# macOS Computer Use

Moxxy's macOS extension owns its native backend: a Swift helper
(`moxxy-computer`, universal arm64 + x86_64, macOS 14+) started as a child of
the host. It does not load Codex, `@oai/sky`, `@oai/cua` or any private system
framework. It speaks helper protocol v5, the same contract as the Windows
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
- Actions take an `element_index` or a point of the latest screenshot. Element
  actions go through accessibility and work while the app is in the background;
  the user's pointer does not move. Real input is the fallback: the app comes
  forward, the helper checks the point (on screen, inside the target app, not
  Moxxy's own window, pixels unchanged since the screenshot), clicks and puts
  the pointer back.
- Command shortcuts are menu key equivalents, so the app is brought forward for
  them. The helper never does that while the user is typing.
- Every action returns `delivered | ineffective | unsupported | blocked` and the
  fresh state. `delivered` is not evidence that the task succeeded. The same
  action leaving the same state twice ends as `ineffective` with `no_progress`
  and the next method to try.
- A save dialog aimed at a protected place (`~/.ssh`, LaunchAgents, shell
  startup files, git hooks) is refused.
- Escape stops the turn. Input from the user pauses the agent; an action waits
  for a quiet moment before using real input. "Take over" releases held input
  and hides the agent's cursor.
- The agent's cursor is a click-through panel above the target window, kept out
  of screenshots. The live view in the desktop chat is a separate stream (H.264,
  or JPEG for a viewer without a video decoder) that never reaches the model or
  the session log.

Not supported: controlling a window on another Space without bringing it here,
private window-server APIs, and apps that refuse both accessibility and
synthetic input.

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
| Pad | points, buttons, scrolling, drags on a view without elements |
| Timeline | clips A and B on a canvas without elements: drag moves, right-edge drag trims |
| Menu: Press Again, New Window, Close Window | Command shortcuts, and an app with no window |

## Trying it in Moxxy

```sh
node packages/cli/dist/bin.js -p "Use Computer Use on Calculator: compute 17 times 23." \
  --allow-tools computer_status,computer_list_apps,computer_request_access,computer_get_app_state,computer_click,computer_press_key
```

The CLI prefers a copy of the plugin under `~/.moxxy/plugins` over the one in
the workspace, so an older installed copy hides local changes.

Results of the trials and the benchmark are in
[`computer-use-rebuild/benchmark.md`](computer-use-rebuild/benchmark.md).
