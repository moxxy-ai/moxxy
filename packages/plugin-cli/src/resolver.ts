import type { PendingToolCall, PermissionContext, PermissionDecision, PermissionResolver } from '@moxxy/sdk';

export type PermissionPromptHandler = (
  call: PendingToolCall,
  ctx: PermissionContext,
) => Promise<PermissionDecision>;

export interface InteractivePermissionResolverOptions {
  readonly prompt: PermissionPromptHandler;
  readonly name?: string;
  readonly sessionAllows?: Set<string>;
}

/**
 * Build a PermissionResolver around an interactive prompt. The `prompt` callback
 * is what an Ink dialog (or readline) implements. This resolver remembers
 * `allow_session` decisions and short-circuits subsequent calls to the same tool.
 */
export function createInteractivePermissionResolver(
  opts: InteractivePermissionResolverOptions,
): PermissionResolver {
  const sessionAllows = opts.sessionAllows ?? new Set<string>();
  return {
    name: opts.name ?? 'interactive',
    async check(call, ctx) {
      if (sessionAllows.has(call.name)) {
        return { mode: 'allow_session', reason: 'allow_session previously granted' };
      }
      const decision = await opts.prompt(call, ctx);
      if (decision.mode === 'allow_session') sessionAllows.add(call.name);
      return decision;
    },
  };
}
