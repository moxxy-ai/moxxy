import { createAuditedAllowListResolver } from '@moxxy/channel-kit';
import type { PermissionResolver } from '@moxxy/sdk';

export interface ImessagePermissionLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Build the iMessage channel's autonomous permission resolver.
 *
 * Like Signal and Slack (and unlike Telegram's inline-keyboard prompts), the
 * iMessage channel runs hands-off: the operator declares trust upfront via
 * `channels.imessage.allowedTools`, and any tool NOT in that list is denied.
 * The trust check + `'*'` expansion + audit-on-auto-approve wiring is the shared
 * {@link createAuditedAllowListResolver} from `@moxxy/channel-kit`; this wrapper
 * binds it to the channel logger so every auto-approved call leaves a trail. An
 * empty list denies everything (effectively read-only).
 *
 * Because this resolver decides synchronously (no deferred operator prompt), it
 * has no pending-prompt state, so `stop()` has nothing to `abortAll` — aborting
 * the in-flight turn is enough.
 */
export function buildImessagePermissionResolver(opts: {
  allowedTools: ReadonlyArray<string>;
  allToolNames: ReadonlyArray<string>;
  logger?: ImessagePermissionLogger;
}): PermissionResolver {
  return createAuditedAllowListResolver({
    name: 'imessage-allow-list',
    allowedTools: opts.allowedTools,
    allToolNames: opts.allToolNames,
    onAutoApprove: (call, { wildcard }) => {
      opts.logger?.info?.('imessage: auto-approved tool call', {
        tool: call.name,
        callId: call.callId,
        wildcard,
      });
    },
  });
}
