import {
  commandRunParamsSchema,
  modeSetActiveParamsSchema,
  permissionAddAllowParamsSchema,
  type CommandRunResult,
} from '../protocol.js';
import type { HandlerContext } from './context.js';

export function handleModeSetActive(ctx: HandlerContext, raw: unknown): Record<string, never> {
  const { name } = modeSetActiveParamsSchema.parse(raw);
  // setActive fires onActiveChange → broadcastInfo (wired in the ctor), so
  // no explicit broadcast needed here.
  ctx.session.modes.setActive(name);
  return {};
}

export async function handlePermissionAddAllow(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { name, reason } = permissionAddAllowParamsSchema.parse(raw);
  await ctx.session.permissions.addAllow({ name, ...(reason ? { reason } : {}) });
  return {};
}

export async function handleCommandRun(
  ctx: HandlerContext,
  raw: unknown,
): Promise<CommandRunResult> {
  const { session, broadcastInfo } = ctx;
  const { name, args, channel } = commandRunParamsSchema.parse(raw);
  const cmd = session.commands.get(name);
  if (!cmd) return { kind: 'error', message: `unknown command: /${name}` };
  const result = await cmd.handler({
    channel,
    sessionId: session.id,
    args,
    session,
  });
  // A command may have changed registries (e.g. /model-ish plugins).
  broadcastInfo();
  return result;
}
