import React from 'react';
import { render, type Instance } from 'ink';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
} from '@moxxy/sdk';
import type { Session } from '@moxxy/core';
import {
  createInteractivePermissionResolver,
  type PermissionPromptHandler,
} from './resolver.js';
import { InteractiveSession } from './InteractiveSession.js';

export interface TuiStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
}

/**
 * Channel implementation that mounts the Ink-based `InteractiveSession`
 * component and routes permission prompts through it. The CLI binary's
 * `moxxy tui` subcommand uses this.
 */
export class TuiChannel implements Channel<TuiStartOpts> {
  readonly name = 'tui';
  readonly permissionResolver: ReturnType<typeof createInteractivePermissionResolver>;
  private promptHandler:
    | ((call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>)
    | null = null;
  private inkInstance: Instance | null = null;

  constructor() {
    this.permissionResolver = createInteractivePermissionResolver({
      name: 'tui',
      prompt: async (call, ctx) => {
        if (!this.promptHandler) {
          return { mode: 'deny', reason: 'TUI not ready' };
        }
        return this.promptHandler(call, ctx);
      },
    });
  }

  async start(opts: TuiStartOpts): Promise<ChannelHandle> {
    const registerInteractiveResolver: (h: PermissionPromptHandler) => void = (handler) => {
      this.promptHandler = handler;
    };

    this.inkInstance = render(
      React.createElement(InteractiveSession, {
        session: opts.session,
        registerInteractiveResolver,
        model: opts.model,
      }),
    );

    return {
      running: this.inkInstance.waitUntilExit(),
      stop: async () => {
        this.inkInstance?.unmount();
      },
    };
  }
}
