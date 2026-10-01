---
title: '@moxxy/plugin-computer-control'
description: Operate desktop applications on macOS and Windows x64 through a bundled native helper.
---

`@moxxy/plugin-computer-control` lets the agent operate real desktop
applications: it reads an app's window as accessibility elements plus a
screenshot, acts on an element or a point, and checks the result. The work is
done by a small native helper shipped with the plugin (Swift on macOS, C++ on
Windows x64) that the plugin starts for one turn and stops when the turn ends.

Linux, Windows ARM64, and a Mac whose helper is missing or does not match the
plugin version expose `computer_status` only; it says why Computer Use is
unavailable.

## Tools

| Tool | Purpose |
|---|---|
| `computer_status` | Readiness and missing system permissions; can open the settings pane. |
| `computer_list_apps` | Installed and running apps with the identifier to pass as `app`. |
| `computer_request_access` | One dialog asking the user for a set of apps and access levels. |
| `computer_get_app_state` | The app's window as indexed elements plus a screenshot; later only what changed. |
| `computer_click`, `computer_scroll` | On an `element_index` or a screenshot point. |
| `computer_type_text`, `computer_press_key` | Text into the focused element or an `element_index`; one key or chord. |
| `computer_set_value`, `computer_perform_secondary_action` | On an `element_index`: set a value, run an action the element lists. |
| `computer_drag` | From one screenshot point to another, for apps without elements (timelines, canvases). |
| `computer_zoom` | A closer look at a region of an app's screenshot. |

Each tool shows the model only the fields it needs: a model fills every field
it is shown, and filler in unused fields was the main cause of failed calls.

On macOS, clicks, drags and scrolling by coordinates go to the app's window
while the app stays in the background and the pointer stays with the user. If
the window shows no change, or the system does not offer that route, the app
comes forward and real input is used.

A control that takes an accessibility press and does nothing gets a real click
when the model asks for the same action again.

A session with more than 200 tools (several MCP servers) sends the model an
index instead of every tool schema; the model loads this plugin's tools with
one call, `load_tool({ name: "computer_*" })`. Set `context.lazyTools` to
`true` or `false` to force it either way.

macOS and Windows x64 share these tools; each system has its own native
helper behind them. Windows specifics are in
[`docs/computer-use-windows.md`](https://github.com/moxxy-ai/moxxy/blob/main/docs/computer-use-windows.md).

## Live view

While a turn works in an app, the desktop chat shows that window in a small
live view with the agent's cursor drawn on top. It is the `computer-preview`
surface of this plugin: the helper captures only while someone is watching,
and the picture is never sent to the model or written to the session log.
The view is H.264 video decoded with WebCodecs; a viewer without a video
decoder, and a Windows system without an H.264 encoder, gets JPEG frames
instead.

## Use

```ts
import { computerControlPlugin } from '@moxxy/plugin-computer-control';
session.pluginHost.registerStatic(computerControlPlugin);
```

## Safety

- Every tool is `permission: 'prompt'`.
- Which apps may be controlled is a separate grant, asked once with
  `computer_request_access` and recorded in the session log, so every client
  of the conversation sees the same grant. Browsers default to read-only and
  terminals to click-only.
- The helper checks before each action that the target app is granted, is the
  one under the point, and has not changed since the model last looked.
- The user sees the agent's cursor and a control strip with Stop, Take over and
  Resume; Escape stops. Touching the app pauses the agent.
- Text and images from applications reach the model marked as untrusted data.

## macOS permissions

The helper needs **Accessibility** and **Screen Recording** for Moxxy (or for
the terminal that runs the CLI), under System Settings → Privacy & Security.
`computer_status` reports which one is missing.

An app with no open window still takes key presses, so a shortcut such as
Command-N can open one. An app can be named by its bundle identifier, by the
name the system shows, or by the name of its bundle.

## Building the macOS helper

```sh
pnpm --filter @moxxy/plugin-computer-control build
packages/plugin-computer-control/native/macos/build.sh
```

This writes the universal binary and its manifest to
`packages/plugin-computer-control/bin/darwin-universal/`. Desktop packaging
(`pnpm --filter @moxxy/desktop run prepare:resources`) refuses to continue on
macOS without it.

## Testing on macOS

```sh
packages/plugin-computer-control/native/macos/Tests/run-computer-use-tests.sh --wait-idle
```

It runs the Swift unit tests and the end-to-end tests against a fixture app.
The end-to-end tests use the real pointer and keyboard for a few seconds at a
time, so leave the mouse and keyboard alone while they run.
