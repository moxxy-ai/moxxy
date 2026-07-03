import { createAllowListResolver } from '@moxxy/sdk';
import type { PendingToolCall, PermissionResolver } from '@moxxy/sdk';

/**
 * Autonomous allow-list permission resolver with an audit hook — the shared
 * wiring for hands-off channels (Slack-style: no human in the loop; the
 * operator declares trust upfront via an `allowedTools` list).
 *
 * Reuses the SDK's {@link createAllowListResolver} (exact-name match →
 * `allow_session`, else `deny`) rather than re-implementing the trust check,
 * and adds the two things every autonomous channel needs:
 *
 *   - `'*'` expansion — `['*']` means "allow every registered tool", expanded
 *     against `allToolNames` at channel-start time (mirrors the CLI's
 *     `--allow-all`). An empty list denies everything (effectively read-only).
 *   - an audit hook — `onAutoApprove` fires for every non-denied call so an
 *     autonomous run leaves a trail of what it ran (channels log it).
 */
export interface AuditedAllowListOptions {
  /** Resolver name surfaced in permission events (e.g. 'slack-allow-list'). */
  readonly name: string;
  readonly allowedTools: ReadonlyArray<string>;
  /** Every registered tool name — the expansion target for `'*'`. */
  readonly allToolNames: ReadonlyArray<string>;
  readonly onAutoApprove?: (
    call: PendingToolCall,
    info: { readonly wildcard: boolean },
  ) => void;
}

export function createAuditedAllowListResolver(opts: AuditedAllowListOptions): PermissionResolver {
  const wildcard = opts.allowedTools.includes('*');
  const effective = wildcard ? [...opts.allToolNames] : [...opts.allowedTools];
  const inner = createAllowListResolver(effective);

  return {
    name: opts.name,
    async check(call, ctx) {
      const decision = await inner.check(call, ctx);
      if (decision.mode !== 'deny') {
        opts.onAutoApprove?.(call, { wildcard });
      }
      return decision;
    },
  };
}
