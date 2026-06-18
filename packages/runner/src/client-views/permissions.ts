import type { PermissionsClientView } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export function makePermissionsView(ctx: ViewContext): PermissionsClientView {
  const { peer } = ctx;
  return {
    addAllow: async (rule) => {
      await peer
        .request(RunnerMethod.PermissionAddAllow, {
          name: rule.name,
          ...(rule.reason ? { reason: rule.reason } : {}),
        })
        .catch(() => undefined);
    },
  };
}
