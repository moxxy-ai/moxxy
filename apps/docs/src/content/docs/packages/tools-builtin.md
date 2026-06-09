---
title: '@moxxy/tools-builtin'
description: Read / Write / Edit / Bash / Grep / Glob / recall / Sleep — the canonical filesystem + shell toolset.
---

`@moxxy/tools-builtin` ships the eight tools every coding agent expects.
It is a regular plugin: the CLI registers it at session setup like any
other built-in — `@moxxy/core` does not depend on it.

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
| `Read` | Read a UTF-8 text file (`cat -n` style numbered lines; `offset`/`limit` paging). | ✓ Reading N files |
| `Write` | Create or overwrite a file (creates parent directories). | ✓ Writing N files |
| `Edit` | In-place edit with exact old/new string matching (`replace_all` optional). | ✓ Editing N files |
| `Bash` | Run a shell command via `/bin/sh`. Cooperative aborts via `ctx.signal`. | – |
| `Grep` | Recursive regex search; returns `path:line:text`. | ✓ Searching for N patterns |
| `Glob` | Glob-style file listing, sorted by mtime. | ✓ Listing N globs |
| `recall` | Retrieve content that turn-boundary elision dropped from context (by `callId`, `seq`, or `turnId`). | – |
| `Sleep` | Interruptible pause (≤ 5 min per call) for waiting on builds/deploys instead of busy-looping. | ✓ Sleeping N pauses |

The compact-render column reflects each tool's `ToolDef.compact` hint
(see `@moxxy/sdk`). Channels MAY use it to group consecutive calls
into a single live block; `Bash` opts out because its output usually
matters per-invocation.

Each tool is exported individually (`bashTool`, `editTool`, …) so a
custom plugin can re-bundle a subset.

## Why these eight

They are the minimum surface a coding agent needs to do anything
useful in a repo, plus the two loop-support tools (`recall` for
context-on-demand elision, `Sleep` for polling). Everything else —
running tests, opening URLs, talking to APIs — is up to plugins.

`dispatch_agent` was moved out of this package into
`@moxxy/plugin-subagents` so subagent support is itself a swappable
block. Install that plugin if you want fan-out.
