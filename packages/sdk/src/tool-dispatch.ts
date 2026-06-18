import { asToolCallId } from './ids.js';
import type { EmittedEvent, MoxxyEvent } from './events.js';
import type { ModeContext } from './mode.js';
import type { ToolCallVerdict } from './hooks.js';
import type { CollectedToolUse, StuckLoopDetector, StuckSignal } from './mode-helpers.js';

/**
 * Execute a single tool-use end-to-end: dispatch `dispatchToolCall` hooks, run
 * the permission check, invoke the tool, and emit the approved/denied/result
 * events. An async generator so a loop strategy can `yield*` it; callers that
 * don't need the events can drain it (`for await (const _ of …) {}`) — either
 * way the events reach the log via `ctx.emit`.
 *
 * Shared by every loop strategy (default, goal, and any contributed mode) so
 * the defensive outer try/catch below lives in ONE place. Without it, a throw
 * from a hook handler / permission resolver / the emit itself escapes the
 * generator and leaves this (and any later) call as an orphan
 * `tool_call_requested` with no matching `tool_result` — which the provider
 * then rejects on the next turn.
 */
export async function* dispatchToolCall(
  ctx: ModeContext,
  t: CollectedToolUse,
  iteration: number,
): AsyncGenerator<MoxxyEvent, void, unknown> {
  try {
    const verdict = await ctx.hooks.dispatchToolCall({
      sessionId: ctx.sessionId,
      // Hand the hook the session's real cwd/env (mirrored onto ModeContext by
      // run-turn / the subagent runtime). Previously hardcoded '' / {}, which
      // silently defeated path-based onToolCall policy/security hooks.
      cwd: ctx.cwd,
      log: ctx.log,
      env: ctx.env,
      turnId: ctx.turnId,
      iteration,
      call: { callId: asToolCallId(t.id), name: t.name, input: t.input },
    });
    const actualInput = verdict.action === 'rewrite' ? verdict.input : t.input;

    const denyReason = hookDeny(verdict);
    if (denyReason) {
      yield* emitDenied(ctx, t, denyReason, 'hook');
      return;
    }

    const decision = await ctx.permissions.check(
      { callId: asToolCallId(t.id), name: t.name, input: actualInput },
      { sessionId: String(ctx.sessionId), toolDescription: ctx.tools.get(t.name)?.description },
    );
    if (decision.mode === 'deny') {
      yield* emitDenied(ctx, t, decision.reason ?? 'denied by resolver', 'resolver');
      return;
    }
    yield await ctx.emit({
      type: 'tool_call_approved',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      callId: asToolCallId(t.id),
      decidedBy: 'resolver',
      mode: decision.mode,
    });

    try {
      const output = await ctx.tools.execute(t.name, actualInput, ctx.signal, {
        callId: t.id,
        sessionId: String(ctx.sessionId),
        turnId: String(ctx.turnId),
        log: ctx.log,
        ...(ctx.subagents ? { subagents: ctx.subagents } : {}),
      });
      yield await ctx.emit({
        type: 'tool_result',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'tool',
        callId: asToolCallId(t.id),
        ok: true,
        output,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind: 'aborted' | 'threw' = ctx.signal.aborted ? 'aborted' : 'threw';
      yield await ctx.emit({
        type: 'tool_result',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'tool',
        callId: asToolCallId(t.id),
        ok: false,
        error: { kind, message },
      });
    }
  } catch (err) {
    // Defensive: a hook handler, permission resolver, or the emit itself threw
    // before we could produce a tool_result. Synthesize a failed result so the
    // event log stays well-formed (no orphan tool_call_requested).
    const message = err instanceof Error ? err.message : String(err);
    yield await ctx.emit({
      type: 'tool_result',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'tool',
      callId: asToolCallId(t.id),
      ok: false,
      error: { kind: 'threw', message: `pre-execute failure: ${message}` },
    });
  }
}

function hookDeny(verdict: ToolCallVerdict): string | null {
  return verdict.action === 'deny' ? verdict.reason : null;
}

async function* emitDenied(
  ctx: ModeContext,
  t: CollectedToolUse,
  reason: string,
  by: 'hook' | 'resolver' | 'policy',
): AsyncGenerator<MoxxyEvent, void, unknown> {
  yield await ctx.emit({
    type: 'tool_call_denied',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    callId: asToolCallId(t.id),
    decidedBy: by,
    reason,
  });
  yield await ctx.emit({
    type: 'tool_result',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'tool',
    callId: asToolCallId(t.id),
    ok: false,
    error: { kind: 'denied', message: reason },
  });
}

/**
 * Run a batch of tool uses in order, handling mid-batch abort. On
 * `ctx.signal.aborted` it synthesizes a failed `tool_result` for every
 * not-yet-run call (so the log never ends on an orphan `tool_call_requested`),
 * emits an `abort`, and returns `true` to tell the caller to stop. Returns
 * `false` after a clean batch. Shared by every loop strategy so the
 * orphan-on-abort guarantee lives in one place.
 */
export async function* executeToolUses(
  ctx: ModeContext,
  toolUses: ReadonlyArray<CollectedToolUse>,
  iteration: number,
): AsyncGenerator<MoxxyEvent, boolean, unknown> {
  // Tracks tool_call_requested events that haven't yet emitted a paired
  // tool_result. On any early-exit (abort) we synthesize results for the
  // leftovers so the event log can't end with orphan tool_call_requested events.
  const unresolved = new Set<string>(toolUses.map((t) => t.id));
  for (const t of toolUses) {
    if (ctx.signal.aborted) {
      for (const orphanId of unresolved) {
        yield await ctx.emit({
          type: 'tool_result',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'tool',
          callId: asToolCallId(orphanId),
          ok: false,
          error: { kind: 'aborted', message: 'turn aborted before tool ran' },
        });
      }
      unresolved.clear();
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'signal aborted during tool execution',
      });
      return true;
    }
    try {
      yield* dispatchToolCall(ctx, t, iteration);
    } finally {
      unresolved.delete(t.id);
    }
  }
  return false;
}

/**
 * How a loop strategy phrases its stuck-loop abort. The skeleton — emit a
 * `tool_call_requested` per call, feed the detector, and on a trip synthesize a
 * failed `tool_result` for every already-emitted call before a fatal error — is
 * identical across strategies and lives in {@link emitRequestsAndDetectStuck};
 * only the wording, and goal mode's extra `goal_stuck` plugin_event, vary.
 */
export interface StuckLoopReport {
  /** Message on the synthesized failed `tool_result` for the calls emitted
   *  before the trip (none of them ran). */
  readonly abortedResultMessage: string;
  /** Explanation for a `near` match (an `exact` match always reads
   *  "with identical input"). */
  readonly nearHint: string;
  /** Build the fatal error message shown to the user. */
  readonly fatalMessage: (info: { toolName: string; count: number; how: string }) => string;
  /** Extra events to emit right before the fatal error — goal mode surfaces a
   *  `goal_stuck` plugin_event here. */
  readonly extraOnStuck?: (info: {
    toolName: string;
    count: number;
    kind: StuckSignal['kind'];
  }) => ReadonlyArray<EmittedEvent>;
}

/**
 * Emit a `tool_call_requested` for each tool use and feed it to the stuck-loop
 * detector. Returns `true` when the detector trips (caller should stop) — after
 * synthesizing a failed `tool_result` for every request emitted this batch.
 * That synthesis is load-bearing: a stuck trip bails WITHOUT running
 * {@link executeToolUses}, so without it the emitted requests are left as orphan
 * `tool_call_requested` events (which render as a tool stuck "running" forever
 * and which the provider rejects next turn). Returns `false` when no trip fired.
 */
export async function* emitRequestsAndDetectStuck(
  ctx: ModeContext,
  toolUses: ReadonlyArray<CollectedToolUse>,
  detector: StuckLoopDetector,
  report: StuckLoopReport,
): AsyncGenerator<MoxxyEvent, boolean, unknown> {
  const emitted: CollectedToolUse[] = [];
  for (const t of toolUses) {
    yield await ctx.emit({
      type: 'tool_call_requested',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'model',
      callId: asToolCallId(t.id),
      name: t.name,
      input: t.input,
    });
    emitted.push(t);
    const sig = detector.record(t.name, t.input);
    if (!sig.stuck) continue;
    for (const r of emitted) {
      yield await ctx.emit({
        type: 'tool_result',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'tool',
        callId: asToolCallId(r.id),
        ok: false,
        error: { kind: 'aborted', message: report.abortedResultMessage },
      });
    }
    const how = sig.kind === 'near' ? report.nearHint : 'with identical input';
    if (report.extraOnStuck) {
      for (const e of report.extraOnStuck({ toolName: t.name, count: sig.count, kind: sig.kind })) {
        yield await ctx.emit(e);
      }
    }
    yield await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: 'fatal',
      message: report.fatalMessage({ toolName: t.name, count: sig.count, how }),
    });
    return true;
  }
  return false;
}
