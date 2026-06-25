---
name: channel-author
description: Build a new Channel (TUI / Telegram / HTTP / web / Slack / ...).
---

# Channel author — implement a `Channel`

A Channel is a bidirectional surface that drives a Session: it feeds user prompts in, renders assistant output back, and installs a `PermissionResolver` so it can interrupt tool execution to ask the user (or its operator).

The shipped channels are `@moxxy/plugin-cli` (Ink TUI), `@moxxy/plugin-telegram` (TOFU pairing + inline keyboard), and `@moxxy/plugin-channel-http` (HTTP server with allow-list auth). The CLI's `bin.ts` knows nothing about specific channels — it dispatches via `moxxy channels <name>` and `moxxy channels <name> <subcommand>`.

## The contract

```ts
interface Channel<TStartOpts = unknown> {
  readonly name: string;
  readonly permissionResolver: PermissionResolver;
  start(opts: TStartOpts): Promise<ChannelHandle>;
}

interface ChannelHandle {
  readonly running: Promise<void>;        // resolves on clean shutdown
  stop(reason?: string): Promise<void>;   // request graceful shutdown
}
```

Plus a `ChannelDef` that the plugin contributes:

```ts
export const myChannelDef = defineChannel({
  name: 'my-channel',
  description: 'one-liner shown by `moxxy channels`',
  create: (deps) => new MyChannel({ vault: deps.vault, logger: deps.logger, ... }),
  isAvailable: async (deps) => {
    // gate the channel: e.g., no token → unavailable. moxxy doctor / channels
    // list use this for friendly messages before construction.
    if (!process.env.MY_TOKEN && !(await opts.vault.has('my-token'))) {
      return { ok: false, reason: 'Set MY_TOKEN or store it in the vault.' };
    }
    return { ok: true };
  },
  subcommands: {
    pair:   { description: 'first-run pairing', run: async (ctx) => ctx.startChannel({ pair: true }) },
    status: { description: 'show token + auth state', run: async (ctx) => { /* one-shot */ return 0 } },
  },
});
```

## Use `createDeferredPermissionResolver` from core

Most channels defer permission decisions to the operator (UI prompt, button click, web form). Core exports the shared scaffold:

```ts
import { createDeferredPermissionResolver } from '@moxxy/core';

const resolver = createDeferredPermissionResolver({
  name: 'my-channel',
  prompt: async (call, ctx) => {
    // Display the request on your UI; return a PermissionDecision when
    // the operator clicks / replies.
    return await this.askUserOnUI(call, ctx);
  },
});

// And in `stop()`:
async stop() {
  resolver.abortAll('channel closed');   // reject any in-flight prompts so callers don't hang
  // ... close transport
}
```

Don't reimplement the pending-prompt tracking yourself; the audit caught a hang because TuiChannel.stop wasn't calling abortAll.

## Wiring the Session

The CLI's `run-channel.ts` orchestrates the boot:

1. Boot a Session via `setupSessionWithConfig(...)`.
2. Construct the channel: `def.create({ cwd, vault, logger, options })`.
3. **Swap the resolver in via `session.setPermissionResolver(channel.permissionResolver)`** — don't monkey-patch `(session as unknown as {resolver}).resolver = ...`.
4. `await channel.start({ session, ...startOpts })`.
5. On SIGINT: `await handle.stop()` → `await session.close()` so plugin `onShutdown` hooks fire.

For channels that serve **concurrent turns on one Session** (HTTP), make sure `core/src/run-turn.ts`'s turnId filter is doing its job — every subscriber there filters by `event.turnId === turnId`. If you wrap your own subscriber, do the same.

## Subcommands

Channels expose maintenance ops via `subcommands` on the ChannelDef. The dispatcher routes `moxxy channels <name> <sub> [args]` to `def.subcommands[sub].run({deps, args, startChannel})`.

- One-shot ops (unpair, status, list-bindings) operate on `deps.vault` and return a number exit code.
- Boot-with-twist ops (Telegram's `pair`) delegate via `ctx.startChannel({...extraStartOpts})` — the CLI forwards everything as start-opts.

## Ship as a plugin

```ts
import { defineChannel, definePlugin } from '@moxxy/sdk';
import { MyChannel } from './channel.js';

export function buildMyChannelPlugin(opts: { vault: VaultStore }): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-my-channel',
    channels: [defineChannel({ name: 'my-channel', /* ... */ })],
  });
}
```

Register from CLI `setup.ts` (for shipped channels) or let auto-discovery pick it up (for third-party).

## Tests

The Telegram plugin's `subcommands.test.ts` is a tight pattern: instantiate the plugin, pull `plugin.channels[0]`, drive each subcommand's `run()` with a stub vault + captured stdout. No real bot/server needed.

For the channel's `start()` flow, use the `@moxxy/testing` `FakeProvider` to script the model, and assert on events emitted via the session log.

## Don't

- **Don't monkey-patch `session.resolver`.** Use `session.setPermissionResolver()`.
- **Don't forget `abortAll` in `stop()`.** Pending permission prompts will hang otherwise.
- **Don't process concurrent turns on one Session without filtering subscribers by turnId.** That's the HTTP cross-talk bug.
- **Don't put CLI specifics in the channel.** The CLI is a dispatcher; channels know only about their transport + the Session.
- **Don't make `isAvailable` perform expensive checks.** It runs every `moxxy channels list` and `moxxy doctor`. Cheap probes only.
