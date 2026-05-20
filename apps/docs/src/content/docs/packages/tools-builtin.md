---
title: '@moxxy/tools-builtin'
description: Read / Write / Edit / Bash / Grep / Glob — the canonical filesystem + shell toolset.
---

`@moxxy/tools-builtin` ships the six tools every coding agent expects.
Core depends on this package directly (it's the only plugin-shaped
package core is allowed to import).

## Install

```sh
pnpm add @moxxy/tools-builtin
```

## Use

```ts
import { builtinToolsPlugin } from '@moxxy/tools-builtin';

session.pluginHost.registerStatic(builtinToolsPlugin);
```

## Tools

| Tool | Purpose | Compact render |
|---|---|---|
| `Read` | Read a file (bytes / lines / pages for PDF). | ✓ Reading N files |
| `Write` | Create or overwrite a file. | ✓ Writing N files |
| `Edit` | In-place edit with old/new string matching. | ✓ Editing N files |
| `Bash` | Run a shell command. Cooperative aborts via `ctx.signal`. | – |
| `Grep` | ripgrep-style search across the workspace. | ✓ Searching for N patterns |
| `Glob` | Glob-style file listing. | ✓ Listing N globs |

The compact-render column reflects each tool's `ToolDef.compact` hint
(see `@moxxy/sdk`). Channels MAY use it to group consecutive calls
into a single live block; `Bash` opts out because its output usually
matters per-invocation.

Each tool is exported individually (`bashTool`, `editTool`, …) so a
custom plugin can re-bundle a subset.

## Why these six

They are the minimum surface a coding agent needs to do anything
useful in a repo. Everything else — running tests, opening URLs,
talking to APIs — is up to plugins.

`dispatch_agent` was moved out of this package into
`@moxxy/plugin-subagents` so subagent support is itself a swappable
block. Install that plugin if you want fan-out.
