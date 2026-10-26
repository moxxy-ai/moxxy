import type { PermissionsClientView } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

/** First runner that keeps `inputEquals`; an older one would save the whole tool. */
const EXACT_ALLOW_PROTOCOL = 32;

export function makePermissionsView(ctx: ViewContext): PermissionsClientView {
  const { peer } = ctx;
  return {
    addAllow: async (rule) => {
      // Saving nothing only means the person is asked again; saving the whole tool would over-grant.
      if (rule.inputEquals && (ctx.serverProtocolVersion() ?? 0) < EXACT_ALLOW_PROTOCOL) return;
      await peer
        .request(RunnerMethod.PermissionAddAllow, {
          name: rule.name,
          ...(rule.reason ? { reason: rule.reason } : {}),
          ...(rule.inputEquals ? { inputEquals: rule.inputEquals } : {}),
        })
        .catch(() => undefined);
    },
  };
}
