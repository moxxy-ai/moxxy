---
title: Permissions
description: The deny-by-default permission engine, allow/deny rules, and the allow-always pattern.
---

Every tool call passes through a `PermissionResolver`. The Channel owns
that resolver — the TUI pops an Ink dialog, the Telegram bot ships an
inline keyboard, the HTTP channel checks a static allow-list — but the
underlying policy file is shared.

## The policy file

Location: `~/.moxxy/permissions.json`. Edit it via `moxxy perms`:

```sh
moxxy perms                              # interactive Ink editor (TTY only)
moxxy perms list                         # print current policy
moxxy perms allow Read "read-only file ops"
moxxy perms allow "Bash:git *" "git is fine"
moxxy perms deny "Bash:rm -rf *" "obvious foot-gun"
moxxy perms remove Read
moxxy perms clear --yes
moxxy perms path
```

`deny` rules win over `allow` rules. The `name` field supports glob-style
matching against the tool name (`*` matches anything inside one segment).

## Built-in resolvers

`@moxxy/core` exports four pre-built `PermissionResolver`s:

| Resolver | Use case |
|---|---|
| `autoAllowResolver` | Test harness; allow everything without prompting. |
| `denyByDefaultResolver` | Refuse anything not on the file policy's allow list. |
| `createAllowListResolver(names)` | Static allow-list (the HTTP channel uses this). |
| `createCallbackResolver(fn)` | Custom logic — your callback returns the decision. |

The TUI's resolver wraps the file policy with an interactive prompt:
file-allowed → silent allow; file-denied → silent deny; otherwise →
"allow once / allow always / deny once / deny always" picker.

## Allow-always

Choosing "allow always" in the TUI persists a rule to the policy file
with `reason: "user chose allow always"`. The next call for the same
tool short-circuits to silent allow. The same option exists in the
Telegram channel's inline keyboard.

## Deny-by-default for headless runs

Headless runs (`moxxy -p ...`) have no human to click. By default they
inherit the file policy and deny everything else. Two escape hatches:

```sh
moxxy -p "..." --allow-tools Read,Glob,Grep   # one-off allow-list
moxxy -p "..." --allow-all                    # everything (use with care)
```

For the HTTP channel, set `channels.http.allowedTools` in your config
— the channel refuses to start without it. See
[HTTP channel](./http-channel.md).

## Plugin-level overrides

Plugins can short-circuit a call via the `onToolCall` hook:

```ts
hooks: {
  onToolCall: async ({ call }) => {
    if (call.name === 'Bash' && /rm -rf/.test(String(call.input.command))) {
      return { action: 'deny', reason: 'destructive command blocked' };
    }
    return { action: 'allow' };
  },
}
```

Hook denies fire before the user-facing resolver sees the call — useful
for audit / guardrail plugins.

## Where it's implemented

- Engine: `packages/core/src/permissions/`.
- TUI dialog: `packages/plugin-cli/src/components/PermissionDialog.tsx`.
- Telegram inline keyboard: `packages/plugin-telegram/src/channel/permission-prompt.ts`.
- HTTP allow-list: `packages/plugin-channel-http/src/channel.ts`.
