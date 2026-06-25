---
name: add-a-slash-command
description: Add a /slash command to moxxy's chat surfaces (TUI/desktop/Telegram) — use for new session-level user commands like /info or /compact.
---

# Add a slash command

Built-ins live in `packages/plugin-commands/src/index.ts` (`/info`, `/clear`,
`/new`, `/compact`, `/exit`, `/help`).

```ts
const myCmd: CommandDef = {           // CommandDef from @moxxy/sdk
  name: 'mything',                    // → /mything
  description: 'Shown in /help.',
  handler: ({ session, args }) => {
    // return { kind: 'text', text } or { kind: 'session-action', action, notice }
  },
};
```

Wire: add to the plugin's `commands: [...]` array (plugin-commands for
general-purpose; your own plugin's `definePlugin({ commands })` for
feature-scoped ones, e.g. vault's `/vault`).

Rules:
- Handlers receive the SESSION — type against the minimal structural slice you
  need (see `SessionShape` in plugin-commands) and use optional chaining for
  capabilities a `RemoteSession` may lack (TECH_DEBT P1 #1).
- Commands run on every surface (TUI, desktop, Telegram) — no Ink/DOM
  imports; return data, let the surface render.
- Destructive actions must verify, not assume: `/new` calls
  `SessionLike.reset?.()` and reports failure instead of claiming success
  (A10).
- `defineCommand` (SDK) freezes the spec — use it for new code.

Test: `plugin-commands/src/commands.test.ts` pattern — fake session, assert
the returned CommandOutput. Then gate + changeset (`@moxxy/cli`).
