import type { PendingToolCall, PermissionContext, PermissionDecision, PermissionResolver } from '@moxxy/sdk';

export const autoAllowResolver: PermissionResolver = {
  name: 'auto-allow',
  async check(): Promise<PermissionDecision> {
    return { mode: 'allow', reason: 'auto-allow resolver (test mode)' };
  },
};

export const denyByDefaultResolver: PermissionResolver = {
  name: 'deny-by-default',
  async check(): Promise<PermissionDecision> {
    return { mode: 'deny', reason: 'No interactive resolver available in headless mode. Use --allow-tools or permissions.json.' };
  },
};

export interface CallbackResolverOptions {
  readonly name?: string;
  readonly callback: (call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>;
}

export function createCallbackResolver(opts: CallbackResolverOptions): PermissionResolver {
  return {
    name: opts.name ?? 'callback',
    check: opts.callback,
  };
}

export function createAllowListResolver(toolNames: ReadonlyArray<string>): PermissionResolver {
  const allowed = new Set(toolNames);
  return {
    name: 'allow-list',
    async check(call) {
      if (allowed.has(call.name)) return { mode: 'allow_session', reason: 'allow-list' };
      return { mode: 'deny', reason: `Tool '${call.name}' not in allow-list` };
    },
  };
}
