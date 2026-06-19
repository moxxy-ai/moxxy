---
title: Quickstart
description: From zero to a running moxxy session in five minutes.
---

## 1. Install

```sh
pnpm add -g @moxxy/cli
# or run ad-hoc:
pnpm dlx @moxxy/cli --help
```

## 2. Pick a provider

`moxxy` supports four providers out of the box (plus runtime-registered
OpenAI-compatible vendors via `@moxxy/plugin-provider-admin`). Pick one:

```sh
# Anthropic — API key
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI — API key
export OPENAI_API_KEY=sk-...

# ChatGPT Pro/Plus (Codex backend) — OAuth, no key needed
moxxy login openai-codex

# Claude Pro/Max — OAuth, no key needed
moxxy login claude-code
```

`moxxy init` walks through the same choices interactively and stores keys
encrypted in the vault. After init you can reference vault entries from
`moxxy.config.ts` via `${vault:NAME}`:

```ts
// moxxy.config.ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  provider: {
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },
  },
});
```

## 3. One-shot prompt

```sh
moxxy -p "list TypeScript files in src/" --allow-tools Read,Glob
```

## 4. Interactive

```sh
moxxy                # Ink-based TUI (default channel)
moxxy resume         # picker for a previous session
```

## 5. Pair the Telegram bot

The pairing direction was inverted in a recent release: the bot now
issues the code, you paste it into the terminal.

```sh
# In a moxxy project, open a pairing window:
moxxy channels telegram pair
# → "Waiting for /start from a Telegram chat…"
```

1. Open Telegram, find your bot, send `/start`.
2. The bot DMs you a 6-digit code.
3. Paste the code into the moxxy terminal. The chat id is persisted to
   the vault; next start the bot auto-authorizes it.

Then run the bot foreground (`moxxy telegram`) or as a background
service (`moxxy service install telegram`). See the
[Telegram channel guide](./guides/telegram-channel.md).

## 6. Save a memory

In the TUI:

> me: I prefer terse responses without bullet points. Remember that.

The agent calls `memory_save`. Next session it can `memory_recall` and
find your preference. Curate with `moxxy memory list|show|revert`.

## 7. Author a skill

Add a Markdown file under `~/.moxxy/skills/` or `./.moxxy/skills/`:

```md
---
name: deploy-to-staging
description: Push the current branch and trigger a staging deploy.
triggers: ["deploy to staging", "push to staging"]
allowed-tools: [Bash]
---
1. Confirm the branch is clean with `git status`.
2. Run `git push origin HEAD:staging --force-with-lease`.
3. Tail the deploy log with `kubectl logs -f deploy/staging-app`.
```

Restart moxxy (or call `reload_skills` mid-session). Next time you say
"deploy to staging" the agent runs your three steps. The agent can also
write skills for itself — see [Authoring a skill](./guides/authoring-a-skill.md).

## Where things live

```
~/.moxxy/
  config.ts            user-level overrides (merged under project moxxy.config.ts)
  permissions.json     user-level allow/deny rules
  vault.json           AES-256-GCM encrypted secrets
  vault.key            cached master key (mode 0600; alt to OS keychain)
  skills/              user-scope skill files
  memory/              journal-based long-term memory + MEMORY.md index
  sessions/            event-log dumps for replay
  schedules.json       scheduler entries
  mcp.json             MCP server catalog
  services/<id>.log    background-service stdout/stderr
```
