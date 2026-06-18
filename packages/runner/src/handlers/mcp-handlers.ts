import { mcpDetachParamsSchema, mcpEnableAndAttachParamsSchema } from '../protocol.js';
import type { HandlerContext } from './context.js';

// MCP (delegates to session.mcpAdmin if the plugin is loaded). All degrade
// cleanly when no MCP-admin plugin is loaded: list → [], the rest throw a
// clear "not available" error.

export async function handleMcpListServers(ctx: HandlerContext): Promise<unknown[]> {
  const admin = ctx.session.mcpAdmin;
  if (!admin) return [];
  return [...(await admin.listServers())];
}

export async function handleMcpEnableAndAttach(
  ctx: HandlerContext,
  raw: unknown,
): Promise<{ toolNames: ReadonlyArray<string> } | null> {
  const params = mcpEnableAndAttachParamsSchema.parse(raw);
  const admin = ctx.session.mcpAdmin;
  if (!admin) throw new Error('mcp admin not available on this runner');
  return admin.enableAndAttach(params.name);
}

export async function handleMcpDetach(ctx: HandlerContext, raw: unknown): Promise<boolean> {
  const params = mcpDetachParamsSchema.parse(raw);
  const admin = ctx.session.mcpAdmin;
  if (!admin) throw new Error('mcp admin not available on this runner');
  return admin.detach(params.name);
}
