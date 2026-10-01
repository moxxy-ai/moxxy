# Linux Computer Use

Moxxy's Linux extension has its own native backend: a C++ helper
(`moxxy-computer`, x64 and arm64) started as a child of the host. It reads apps
through the accessibility bus (AT-SPI) and works with windows through X11. It
speaks helper protocol v5, the same contract as the macOS and Windows helpers,
so the model sees the same 12 tools (see
[`computer-use-rebuild/README.md`](computer-use-rebuild/README.md)).

## What it needs

- An **X11 session**. In a Wayland session one app cannot see or operate
  another, so `computer_status` reports `ready: false` and says to log in with
  an X11 (Xorg) session. Apps running through XWayland are not enough.
- The accessibility bus (`at-spi2-core`), which every common desktop starts.
  The helper switches the session's accessibility on while it runs and puts it
  back when it leaves. An app that was started before that may need a restart
  to show its elements; without elements the screenshot and coordinates still
  work.
- The XTEST extension for input and, for a whole picture of a covered window,
  a compositing X server (XComposite). Without it the picture shows what the
  screen shows of the window.
- Shared libraries at run time: `libatspi`, `libglib`/`libgio`, `libX11`,
  `libXtst`, `libXext`, `libXfixes`, `libXcomposite`, `libXi` (Debian/Ubuntu:
  `libatspi2.0-0 libxtst6 libxcomposite1 libxi6 libxfixes3`). The JPEG encoder
  is linked in. The released helper is built on Ubuntu 24.04 (glibc 2.39).

There are no permission prompts on X11: any app of the session may read
windows and send input.

## Operating contract

- Every operation uses the tool permission pipeline, and an app must be granted
  with `computer_request_access` before it is observed or operated. Browsers
  default to read-only and terminals to click-only. UI text is untrusted.
- An app is addressed by the name of its desktop file without `.desktop`
  (`org.gnome.Calculator`). A request may also name it by the name the desktop
  shows or by its program (`gnome-calculator`). A running program without a
  desktop file is known by its window class.
- `computer_get_app_state` starts an app that is not running and waits for it
  to settle (accessibility events, up to 5 s). It returns the elements of the
  app's topmost window, each with an `element_index`, and a JPEG of the
  window. An index stays with its element for as long as the element lives.
  Password fields are listed without a value.
- A plain click on a control (button, check box, menu item, link, tab) is its
  accessibility action: the app stays in the background and the pointer does
  not move. Text goes into a field at the caret through accessibility, and
  `computer_set_value` sets a field's text or a slider's number.
- Everything else is real input through XTEST: other buttons, double clicks,
  clicks with modifiers, clicks on a canvas, scrolling, dragging, key chords,
  and typing into what has focus. The window comes forward first, the point
  must be on screen and on the target window (not Moxxy's own), the pixels
  around a screenshot point must be unchanged, and the user's pointer goes back
  afterwards. Characters the keyboard layout lacks are typed through a spare
  key that is bound for the moment.
- A control that accepts an accessibility press and leaves the window looking
  the same gets a real click when the same click is asked for again.
- Every action returns `delivered | ineffective | unsupported | blocked` and
  the fresh state. `delivered` is not evidence that the task succeeded.
- Escape stops the turn. Real input waits for a moment in which the user is
  not using the mouse or keyboard. "Take over" releases held input and hides
  the agent's cursor.
- The agent's cursor is a dot above the windows that lets clicks through; it
  is not part of window pictures. The live view in the desktop chat is JPEG
  pictures (up to 5 a second) that never reach the model or the session log.

Not supported yet: Wayland, choosing a window by `window_id`, the guard on
save dialogs aimed at protected places, scrolling without real input, starting
an app without its window taking the focus, and H.264 video for the live view.
Reading a large tree takes one bus call per property, so a window with a
thousand elements takes a few seconds.

## Build and test

```sh
cd packages/plugin-computer-control
sudo native/linux/deps.sh --test        # Debian/Ubuntu: libraries and a headless desktop
pnpm build                              # the helper's manifest writer
native/linux/build.sh                   # unit tests, bin/linux-<arch>/moxxy-computer + manifest
native/linux/desktop.sh npx vitest run src/linux
```

`desktop.sh` runs a command inside a headless X11 desktop (Xvfb, a session bus
with the accessibility bus, openbox), so the end-to-end tests never touch the
real pointer. On a host that is not Linux, prefix each command with
`native/linux/docker.sh`, which runs it in the build image
(`native/linux/Dockerfile`). CI runs the same on x64 and arm64
(`.github/workflows/computer-use-linux.yml`).

## Fixture app

`native/linux/fixture` builds `moxxy-computer-fixture` (GTK 3). The tests
install it for the run with a desktop file under a temporary `XDG_DATA_HOME`.

| Part | What it tests |
|---|---|
| Name field, Press button, status label | element actions in the background |
| Secret field | a password value is never read |
| "Loaded" label | content that appears after a delay (settling) |
| Disabled button, Remember check box | states |
| Amount spin button | a numeric value |
| Dud button | a control with no effect |
| Stubborn button | ignores an accessibility press, counts real clicks |
| Pad | points, buttons, modifiers, scrolling, drags on a view without elements |
| Key label | key chords |
