import { createAuditedAllowListResolver } from '@moxxy/channel-kit';
import type { PermissionResolver } from '@moxxy/sdk';

export interface SignalPermissionLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Build the Signal channel's autonomous permission resolver.
 *
 * Like Slack (and unlike Telegram's inline-keyboard prompts), the Signal
 * channel runs hands-off: the operator declares trust upfront via
 * `channels.signal.allowedTools`, and any tool NOT in that list is denied.
 * The trust check + `'*'` expansion + audit-on-auto-approve wiring is the
 * shared {@link createAuditedAllowListResolver} from `@moxxy/channel-kit`;
 * this wrapper binds it to the channel logger so every auto-approved call
 * leaves a trail. An empty list denies everything (effectively read-only).
 */
export function buildSignalPermissionResolver(opts: {
  allowedTools: ReadonlyArray<string>;
  allToolNames: ReadonlyArray<string>;
  logger?: SignalPermissionLogger;
}): PermissionResolver {
  return createAuditedAllowListResolver({
    name: 'signal-allow-list',
    allowedTools: opts.allowedTools,
    allToolNames: opts.allToolNames,
    onAutoApprove: (call, { wildcard }) => {
      opts.logger?.info?.('signal: auto-approved tool call', {
        tool: call.name,
        callId: call.callId,
        wildcard,
      });
    },
  });
}
