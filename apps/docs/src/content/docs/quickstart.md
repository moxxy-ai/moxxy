---
title: Quickstart
description: Install moxxy, connect a model account, and complete a first task.
---

## 1. Install

Moxxy requires Node.js 20.10 or newer.

```sh
npm install -g @moxxy/cli
```

## 2. Connect a model account

Run onboarding inside the project you want moxxy to understand:

```sh
cd your-project
moxxy onboard
```

Choose an API provider, ChatGPT account, or existing Claude Code subscription
and authenticate. Keys are stored in the encrypted local vault. Moxxy selects
the recommended model, runtime, and local memory index automatically.

No configuration file is required.

## 3. Start working

```sh
moxxy
```

Start with a read-only task:

> Explain the request path through this repository and point me to the main files.

Then ask for a small change. Moxxy will show consequential tool calls and ask
for approval before executing them.

For a single response without the interactive UI:

```sh
moxxy -p "summarize the README in three bullets"
```

Resume an earlier run with `moxxy resume`.

## Add capabilities later

```sh
moxxy extensions list
moxxy onboard --advanced
moxxy help advanced
```

Advanced onboarding adds channels, background services, and runtime choices.
It is optional and should come after the first useful local run.

## If setup fails

Run `moxxy doctor --check-keys`. When opening an issue, include the OS, Node
version, install method, selected model connection, failing step, and sanitized
output. Never include a key or OAuth token.

Next: [Developer alpha](./developer-alpha.md),
[Permissions](./guides/permissions.md), or
[Authoring a skill](./guides/authoring-a-skill.md).
