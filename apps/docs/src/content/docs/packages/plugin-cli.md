---
title: '@moxxy/plugin-cli'
description: The Ink-based TUI channel and shared TUI components.
---

`@moxxy/plugin-cli` ships the default `tui` channel — Ink (React for
terminals) rendering the chat view, permission dialog, prompt input,
and setup wizards — plus a handful of components and helpers reused by
other CLI surfaces.

## Install

```sh
pnpm add @moxxy/plugin-cli
```

The `@moxxy/cli` binary depends on this for its TUI; the package itself
is also useful when embedding a TUI elsewhere.

## Channel

```ts
import { tuiChannelDef, cliPlugin } from '@moxxy/plugin-cli';

session.pluginHost.registerStatic(cliPlugin);
session.channels.setActive('tui');
```

`isAvailable` refuses to boot when stdin isn't a TTY (use
`moxxy -p ...` for headless instead).

## Components

| Export | Purpose |
|---|---|
| `InteractiveSession` | Top-level Ink component: boot steps + chat. |
| `ChatView` | Streamed assistant + tool activity renderer. |
| `PromptInput` | Multi-line input with command + slash-command autocomplete. |
| `PermissionDialog` | "allow once / allow always / deny once / deny always" picker. |
| `PermissionEditor` | Standalone Ink editor for `~/.moxxy/permissions.json` (`moxxy perms` mounts this). |
| `Logo`, `LOGO_LINES`, `SLOGANS`, `pickSlogan` | Branding helpers. |

## Resolver

`createInteractivePermissionResolver({ onPrompt })` returns a
`PermissionResolver` that funnels every check into the user-supplied
`onPrompt` callback (typically wiring the Ink dialog).

## Setup YAML

`renderYaml(selections)` and `SetupChoice`/`SetupSelections` types
back the post-wizard "here's the YAML that would be written"
preview. The wizard itself lives in `packages/cli/src/wizard/`.

## Preferences

Re-exports `loadPreferences` / `savePreferences` / `preferencesPath`
from `@moxxy/core` for TUI components that need to read user prefs
(theme, default loop, etc.) without re-implementing the file format.

## TUI hotkeys

Most keys are scoped to the input editor (Ctrl+A/E/K/U/W/Y, Tab,
Alt+Arrows, etc.). Three global hotkeys always fire — routed through
the editor's parser so they reach the handler even while typing:

| Key | Effect |
|---|---|
| `Esc` / `Ctrl+C` | Cancel the current turn (only while busy, no overlay open). |
| `Ctrl+O` | Toggle expand/collapse of all live tool-call blocks. |
| `Ctrl+T` | Force-send the first queued message — runs alone after the current turn, bypassing the auto-merge. |
| `Ctrl+B` | Drop the first queued message. |

## Live tool blocks

Consecutive "compact" tool calls (`Read`, `Grep`, `Glob`, `Edit`,
`Write` — anything whose `ToolDef.compact` is set) aggregate into a
single live block with a verb summary:

```
● Reading 3 files, searching for 1 pattern, listing 2 globs… (ctrl+o to expand)
  └ packages/plugin-cli/src/components/chat/pair-events.ts
```

`Ctrl+O` expands every live block to render each call individually.
Verbose tools (`Bash`, `dispatch_agent`, MCP tools — anything without
`compact`) always render as their own block. Settled blocks (a turn
ago) freeze in their last expand state; only in-flight blocks
re-render on toggle.

## Queue strip

When you type while a turn is running, your message goes into a queue
and a dim strip appears directly above the input box:

```
──────────────────────────────
↑ queued: fetch latest stats · +2 more · ⌃t send · ⌃b drop
[input box]
```

`Ctrl+T` pops the head of the queue into a "priority" slot — when the
current turn ends, the priority message runs alone (bypassing the
default behavior of joining all queued messages into one follow-up).
`Ctrl+B` drops the first queued message without running it. `/queue`
and `/clear-queue` slash commands still work for reviewing or
emptying the whole backlog.
