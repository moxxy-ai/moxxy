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

## 2. Set up the provider

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Or store it encrypted in the vault and reference it via `moxxy.config.ts`:

```sh
moxxy            # starts the TUI
# in the TUI, ask: "save my Anthropic key in the vault"
# the agent will call vault_set('ANTHROPIC_API_KEY', '...') (with your approval)
```

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
moxxy                # Ink-based TUI
moxxy telegram pair  # show a pairing code, start the Telegram bot
moxxy telegram       # restart after pairing
```

## 5. Save a memory

In the TUI:

> me: I prefer terse responses without bullet points. Remember that.

The agent will call `memory_save`. Next session it can `memory_recall` and find your preference.

## 6. Author a skill

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

Restart moxxy (or call `reload_skills` mid-session). Next time you say "deploy to staging" the agent runs your three steps.

## Where things live

```
~/.moxxy/
  config.ts          user-level overrides (merged under project moxxy.config.ts)
  permissions.json   user-level allow/deny rules
  vault.json         AES-256-GCM encrypted secrets
  skills/            user-scope skill files
  memory/            journal-based long-term memory + MEMORY.md index
  sessions/          event-log dumps for replay
```
