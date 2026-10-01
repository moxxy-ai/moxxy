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

## Tools (macOS)

| Tool | Purpose |
|---|---|
| `computer_status` | Readiness and missing system permissions; can open the settings pane. |
| `computer_list_apps` | Installed and running apps with the identifier to pass as `app`. |
| `computer_request_access` | One dialog asking the user for a set of apps and access levels. |
| `computer_get_app_state` | The app's window as indexed elements plus a screenshot; later only what changed. |
| `computer_click`, `computer_type_text`, `computer_paste`, `computer_press_key`, `computer_scroll`, `computer_set_value`, `computer_select_text`, `computer_perform_secondary_action` | Actions on an `element_index` or a screenshot point. |
| `computer_drag`, `computer_mouse`, `computer_hold_key` | Gestures for apps without elements (timelines, canvases). |
| `computer_batch` | Several predictable steps in one call; stops at the first that is not delivered. |
| `computer_screenshot`, `computer_zoom` | The whole display with only granted apps visible; a closer look at a region. |

Windows x64 still uses its earlier tool set (`computer_observe`,
`computer_windows`, …) until it moves to this one. See
[`docs/computer-use-windows.md`](https://github.com/moxxy-ai/moxxy/blob/main/docs/computer-use-windows.md).

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

## Building the macOS helper

```sh
pnpm --filter @moxxy/plugin-computer-control build
packages/plugin-computer-control/native/macos/build.sh
```

This writes the universal binary and its manifest to
`packages/plugin-computer-control/bin/darwin-universal/`. Desktop packaging
(`pnpm --filter @moxxy/desktop run prepare:resources`) refuses to continue on
macOS without it.
