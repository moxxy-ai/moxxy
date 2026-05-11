---
title: Authoring a channel
description: Implement Channel<T> to ship a new bidirectional frontend.
---

A **Channel** is what drives a Session: it feeds in user prompts, renders assistant chunks + tool activity, and provides the `PermissionResolver`. The TUI (`@moxxy/plugin-cli`) and Telegram (`@moxxy/plugin-telegram`) are both Channels. To ship a new one — Slack, Discord, HTTP, anything — implement this interface:

```ts
import type { Channel, ChannelHandle, PermissionResolver } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';

interface SlackStartOpts {
  readonly session: Session;
  readonly channelId: string;
}

export class SlackChannel implements Channel<SlackStartOpts> {
  readonly name = 'slack';
  readonly permissionResolver: PermissionResolver = /* ... */;

  async start(opts: SlackStartOpts): Promise<ChannelHandle> {
    // 1. Connect to your transport (webhook, socket mode, etc).
    // 2. On incoming user message → call runTurn(opts.session, text).
    // 3. Subscribe to opts.session.log to render events out.
    // 4. Wire your permission resolver: when a tool call needs approval,
    //    pop a UI element (button, reaction, modal) and resolve the Promise.

    return {
      running: /* a promise that resolves on graceful shutdown */,
      stop: async (reason) => { /* close transport */ },
    };
  }
}
```

## Pattern: the permission resolver

Channels typically expose a permission UI (inline keyboard, button, modal). The trick is that `PermissionResolver.check()` returns a Promise — so you need a way to deliver the decision back. Pattern:

```ts
const pending = new Map<string, (d: PermissionDecision) => void>();

const resolver: PermissionResolver = {
  name: 'slack',
  async check(call, ctx) {
    return new Promise((resolve) => {
      pending.set(call.callId, resolve);
      // …render a Slack message with Allow / Deny buttons …
    });
  },
};

// When the user clicks a button:
function onButtonClick(callId: string, choice: 'allow' | 'deny') {
  const resolve = pending.get(callId);
  if (!resolve) return;
  pending.delete(callId);
  resolve(choice === 'allow' ? { mode: 'allow' } : { mode: 'deny', reason: 'user clicked Deny' });
}
```

`@moxxy/plugin-telegram` and `@moxxy/plugin-cli`'s resolvers both use this pattern — copy from either.

## Pattern: streaming output

Most chat APIs rate-limit message edits. Don't send one message per `assistant_chunk` — accumulate chunks, edit a single placeholder message every ~1 second. See `TurnRenderer` in `@moxxy/plugin-telegram`.
