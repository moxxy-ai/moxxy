import { createAllowListResolver } from '@moxxy/sdk';
import type {
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  PermissionResolver,
} from '@moxxy/sdk';

export interface SlackPermissionLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Build the Slack channel's autonomous permission resolver.
 *
 * The bot runs hands-off (no human-in-the-loop, like the HTTP channel): the
 * operator declares trust upfront via `channels.slack.allowedTools`, and any
 * tool NOT in that list is denied. We REUSE the shared
 * {@link createAllowListResolver} (exact-name match → `allow_session`, else
 * `deny`) rather than re-implementing the trust check; this wrapper adds:
 *
 *   - `'*'` expansion — the allow-list `['*']` means "allow every registered
 *     tool". The CLI's `prompt.ts --allow-all` handles this by passing the full
 *     tool list; we mirror that by expanding `*` against `allToolNames` at
 *     start() time. An empty list denies everything (effectively read-only,
 *     since no side-effecting tool can run without a clicker).
 *   - audit logging — every auto-approved call is logged via the channel
 *     logger, so an autonomous run leaves a trail of what it ran.
 *
 * (Autonomous allow-list safety is a known trade-off; see TECH_DEBT — v1 has no
 * Slack-button approval flow.)
 */
export function buildSlackPermissionResolver(opts: {
  allowedTools: ReadonlyArray<string>;
  allToolNames: ReadonlyArray<string>;
  logger?: SlackPermissionLogger;
}): PermissionResolver {
  const wildcard = opts.allowedTools.includes('*');
  const effective = wildcard ? [...opts.allToolNames] : [...opts.allowedTools];
  const inner = createAllowListResolver(effective);

  return {
    name: 'slack-allow-list',
    async check(call: PendingToolCall, ctx: PermissionContext): Promise<PermissionDecision> {
      const decision = await inner.check(call, ctx);
      if (decision.mode !== 'deny') {
        opts.logger?.info?.('slack: auto-approved tool call', {
          tool: call.name,
          callId: call.callId,
          wildcard,
        });
      }
      return decision;
    },
  };
}
