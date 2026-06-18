import { pageEvents, readSessionEventPage } from '@moxxy/core';
import {
  commandRunParamsSchema,
  modeSetActiveParamsSchema,
  permissionAddAllowParamsSchema,
  sessionLoadHistoryParamsSchema,
  sessionSetReasoningParamsSchema,
  type CommandRunResult,
  type SessionLoadHistoryResult,
} from '../protocol.js';
import type { HandlerContext } from './context.js';

export function handleModeSetActive(ctx: HandlerContext, raw: unknown): Record<string, never> {
  const { name } = modeSetActiveParamsSchema.parse(raw);
  // setActive fires onActiveChange → broadcastInfo (wired in the ctor), so
  // no explicit broadcast needed here.
  ctx.session.modes.setActive(name);
  return {};
}

/**
 * Set the session's reasoning/thinking effort (v9). Mirrors the CLI's proven
 * `config.context.reasoning` path: `off` clears the preference, the others map
 * onto `session.reasoning = { effort }`. `run-turn` forwards it to each turn's
 * ModeContext, and `collectProviderStream` gates it on the active model's
 * `supportsReasoning` flag — so a provider that ignores the knob is unaffected.
 * Broadcast the fresh snapshot so attached clients reflect the new effort.
 */
export function handleSessionSetReasoning(
  ctx: HandlerContext,
  raw: unknown,
): Record<string, never> {
  const { effort } = sessionSetReasoningParamsSchema.parse(raw);
  ctx.session.reasoning = effort === 'off' ? undefined : { effort };
  ctx.broadcastInfo();
  return {};
}

/**
 * Page the runner's AUTHORITATIVE event history (v10). Backs the desktop's
 * dual-history retirement — the renderer reads transcript history from here
 * instead of its own NDJSON store. Newest-first paging: `before: null` is the
 * newest page; `prevCursor` is the cursor for the next older page (`null` once
 * the start of history is reached).
 *
 * Source of truth: the runner's in-memory `EventLog` is the live, append-only
 * authority and (for the runner's own session) always holds the conversation
 * from seq 0 — `restoreEvents` re-sequences a resumed log to 0..n-1 and live
 * turns append from there. So when `log.baseSeq === 0` we page straight out of
 * the in-memory log (no disk read; includes live-streamed events not yet
 * flushed). The disk reader is the fallback for the "log isn't all in memory"
 * case (a future tail-seeded log, `baseSeq > 0`): it pages one window out of the
 * persisted JSONL without re-materializing the whole conversation. Both paths
 * share {@link pageEvents}' exact semantics so a client crossing between them
 * sees no discontinuity.
 */
export async function handleSessionLoadHistory(
  ctx: HandlerContext,
  raw: unknown,
): Promise<SessionLoadHistoryResult> {
  const { before, limit } = sessionLoadHistoryParamsSchema.parse(raw);
  const log = ctx.session.log;
  if (log.baseSeq === 0) {
    // The in-memory log holds the start of history — page it directly.
    return pageEvents(log.toJSON(), before, limit);
  }
  // Tail-seeded / partial in-memory log: read one page off disk instead so the
  // oldest history (below the in-memory base) is still reachable.
  return readSessionEventPage(String(ctx.session.id), { before, limit }, ctx.sessionsDir);
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
