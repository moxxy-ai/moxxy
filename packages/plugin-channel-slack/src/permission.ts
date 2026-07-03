import { createAuditedAllowListResolver } from '@moxxy/channel-kit';
import type { PermissionResolver } from '@moxxy/sdk';

export interface SlackPermissionLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Build the Slack channel's autonomous permission resolver.
 *
 * The bot runs hands-off (no human-in-the-loop, like the HTTP channel): the
 * operator declares trust upfront via `channels.slack.allowedTools`, and any
 * tool NOT in that list is denied. The trust check + `'*'` expansion +
 * audit-on-auto-approve wiring is the shared
 * {@link createAuditedAllowListResolver} from `@moxxy/channel-kit` (which in
 * turn reuses the SDK's `createAllowListResolver`: exact-name match →
 * `allow_session`, else `deny`); this wrapper binds it to the Slack channel
 * logger so every auto-approved call leaves a trail of what the autonomous run
 * executed. An empty list denies everything (effectively read-only, since no
 * side-effecting tool can run without a clicker).
 *
 * (Autonomous allow-list safety is a known trade-off; see TECH_DEBT — v1 has no
 * Slack-button approval flow.)
 */
export function buildSlackPermissionResolver(opts: {
  allowedTools: ReadonlyArray<string>;
  allToolNames: ReadonlyArray<string>;
  logger?: SlackPermissionLogger;
}): PermissionResolver {
  return createAuditedAllowListResolver({
    name: 'slack-allow-list',
    allowedTools: opts.allowedTools,
    allToolNames: opts.allToolNames,
    onAutoApprove: (call, { wildcard }) => {
      opts.logger?.info?.('slack: auto-approved tool call', {
        tool: call.name,
        callId: call.callId,
        wildcard,
      });
    },
  });
}
