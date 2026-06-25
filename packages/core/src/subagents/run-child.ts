/**
 * Subagent runtime — turns the SDK's `SubagentSpawner` interface into a
 * working factory that spawns child modes sharing the parent Session's
 * registries.
 *
 * Each child gets:
 *  - Its own `EventLog` (isolated history, no cross-talk).
 *  - Its own `sessionId` + `turnId` (so hooks / tool ctxs see distinct ids).
 *  - The parent's providers, tools (optionally filtered), skills, permissions,
 *    plugin host, and abort signal.
 *
 * As the child runs, this module streams its events into the parent's log
 * as `plugin_event` records with `subagent_*` subtypes — so the TUI, JSON
 * exporters, and other subscribers see live progress without waiting for
 * the child's final message. The captured final assistant message is
 * returned to the spawner caller via the `SubagentResult`.
 *
 * A child spawned with `retainSession: true` keeps its log + context alive in
 * the {@link RetainedChildSession} registry so `continue()` can append an
 * operator reply and run it again — the workflow `awaitInput` pause/resume
 * flow. `subagent_completed` is deferred until that follow-up turn (or a
 * `release()`).
 */

import type {
  EmittedEvent,
  ModeContext,
  MoxxyEvent,
  SessionId,
  StopReason,
  SubagentContinueArgs,
  SubagentResult,
  SubagentSpawner,
  SubagentSpec,
  ToolRegistry,
  TurnId,
} from '@moxxy/sdk';
import { EventLog } from '../events/log.js';
import { newSessionId, newTurnId } from '../events/factory.js';
import type { SessionRuntime } from '../session-runtime.js';
import {
  emitSubagentCompleted,
  emitSubagentStart,
  emitSubagentWarning,
  streamChildEventToParent,
} from './events.js';
import { buildFilteredToolRegistry } from './tools.js';
import {
  claimRetainedChild,
  registerRetainedChild,
  releaseRetainedChild,
  unclaimRetainedChild,
  type RetainedChildSession,
} from './registry.js';

export interface SubagentRuntime {
  readonly parentSession: SessionRuntime;
  readonly parentTurnId: TurnId;
  readonly parentSignal: AbortSignal;
  readonly parentModel: string;
}

type ResolvedStrategy =
  | { strategy: ReturnType<SessionRuntime['modes']['list']>[number]; strategyName: string }
  | { failure: SubagentResult };

export async function runChildTurn(args: {
  rt: SubagentRuntime;
  spec: SubagentSpec;
  retainSession: boolean;
}): Promise<SubagentResult> {
  const { rt, spec, retainSession } = args;
  const { parentSession, parentTurnId } = rt;
  const childSessionId = newSessionId();
  const childTurnId = newTurnId();
  const label = spec.label ?? `subagent-${String(childSessionId).slice(-6)}`;
  const requestedStrategy = spec.mode ?? 'default';

  const resolved = await resolveStrategy(
    parentSession,
    parentTurnId,
    label,
    childSessionId,
    spec,
    requestedStrategy,
  );
  if ('failure' in resolved) return resolved.failure;
  const { strategy, strategyName } = resolved;

  // `undefined` means "inherit the full parent registry"; a present-but-empty
  // array means "deny all" (least-privilege). Collapsing the two would turn an
  // explicit [] into full tool inheritance — the opposite of the caller's intent.
  const toolRegistry: ToolRegistry =
    spec.allowedTools === undefined
      ? parentSession.tools
      : buildFilteredToolRegistry(parentSession.tools, new Set(spec.allowedTools));

  const childModel = await resolveChildModel(rt, spec, label, childSessionId);

  const childLog = new EventLog();
  // The nested spawner's parentModel must be the CHILD's effective model —
  // building it from the original rt would make grandchildren silently
  // revert to the grandparent's model.
  const spawner = createSubagentSpawner({ ...rt, parentModel: childModel });
  const childCtx = buildChildContext(
    rt,
    spec,
    childModel,
    childSessionId,
    childTurnId,
    toolRegistry,
    childLog,
    spawner,
  );
  const capture = await executeChildLoop({
    rt,
    spec,
    label,
    childSessionId,
    childTurnId,
    childLog,
    childCtx,
    strategy,
    strategyName,
    emitCompleted: !retainSession,
  });

  if (retainSession) {
    const evicted = registerRetainedChild({
      label,
      childSessionId,
      childTurnId,
      childLog,
      childCtx,
      spec,
      strategy,
      strategyName,
      parentSession,
      parentTurnId,
      tokensUsed: capture.tokensUsed,
    });
    // A capped/TTL-expired paused child is now unreachable: its `continue()`
    // will fail. Surface that on the EVICTED child's own parent log (best-effort
    // — a warning append must never take this spawn down) so the operator who
    // started it isn't left waiting on a resume that can no longer happen.
    await warnEvicted(evicted);
  }

  return capture.result;
}

/**
 * Emit a `subagent_warning` on each evicted child's OWN parent log so the
 * operator who spawned a now-unreachable paused child sees why its `continue()`
 * will fail. Best-effort: a warning-append reject (or a since-closed parent
 * session) must never propagate out of the spawn that triggered the eviction.
 */
async function warnEvicted(evicted: ReadonlyArray<RetainedChildSession>): Promise<void> {
  for (const e of evicted) {
    try {
      await emitSubagentWarning(
        e.parentSession,
        e.parentTurnId,
        e.label,
        e.childSessionId,
        `retained subagent "${e.label}" was evicted before resume ` +
          `(retention cap or TTL reached); its continue() will no longer work`,
      );
    } catch {
      // A closed/failing parent log must not abort the spawn that evicted it.
    }
  }
}

export async function continueChildTurn(args: {
  childSessionId: SessionId;
  prompt: string;
  label?: string;
}): Promise<SubagentResult> {
  // Claim-then-run: atomically remove the entry from the registry and mark it
  // busy so a racing continue()/release() for the same id can't observe the
  // live entry and drive strategy.run over the same childLog/childCtx in
  // parallel (interleaved appends, double-seeded prompts, double release).
  const retained = claimRetainedChild(args.childSessionId);
  if (!retained) {
    throw new Error(`no retained subagent session for "${String(args.childSessionId)}"`);
  }

  try {
    await retained.childLog.append({
      type: 'user_prompt',
      sessionId: retained.childSessionId,
      turnId: retained.childTurnId,
      source: 'user',
      text: args.prompt,
    });

    const rt: SubagentRuntime = {
      parentSession: retained.parentSession,
      parentTurnId: retained.parentTurnId,
      // Re-derive the resume signal from the still-live owning session rather
      // than reusing the possibly-already-aborted per-turn signal captured at
      // first-turn spawn time (which would cancel the resume before any work).
      parentSignal: retained.parentSession.signal,
      parentModel: retained.childCtx.model,
    };

    const capture = await executeChildLoop({
      rt,
      spec: retained.spec,
      label: args.label ?? retained.label,
      childSessionId: retained.childSessionId,
      childTurnId: retained.childTurnId,
      childLog: retained.childLog,
      childCtx: retained.childCtx,
      strategy: retained.strategy,
      strategyName: retained.strategyName,
      emitCompleted: true,
      skipStartEvent: true,
      // Carry forward the cost accumulated across prior turns so the deferred
      // subagent_completed reports the retained session's cumulative usage, not
      // just this last continue's delta.
      priorTokensUsed: retained.tokensUsed ?? 0,
    });

    return capture.result;
  } finally {
    // The entry was already removed by the claim; just drop the busy marker so
    // a future continue() (if the session were re-registered) isn't blocked.
    unclaimRetainedChild(args.childSessionId);
  }
}

async function executeChildLoop(args: {
  rt: SubagentRuntime;
  spec: SubagentSpec;
  label: string;
  childSessionId: ReturnType<typeof newSessionId>;
  childTurnId: TurnId;
  childLog: EventLog;
  childCtx: ModeContext;
  strategy: RetainedChildSession['strategy'];
  strategyName: string;
  emitCompleted: boolean;
  skipStartEvent?: boolean;
  priorTokensUsed?: number;
}): Promise<{ result: SubagentResult; tokensUsed: number }> {
  const {
    rt,
    spec,
    label,
    childSessionId,
    childTurnId,
    childLog,
    childCtx,
    strategy,
    strategyName,
    emitCompleted,
    skipStartEvent,
    priorTokensUsed = 0,
  } = args;
  const { parentSession, parentTurnId } = rt;

  const capture = {
    text: '',
    stopReason: 'end_turn' as StopReason,
    error: null as string | null,
    tokensUsed: priorTokensUsed,
  };

  const unsubCapture = childLog.subscribe((e) => {
    if (e.type === 'assistant_message') {
      if (e.content) capture.text = e.content;
      if (e.stopReason) capture.stopReason = e.stopReason;
    } else if (e.type === 'provider_response') {
      // Sum every provider call's tokens so the parent can show how much this
      // child consumed (input + output, matching a context-meter reading).
      capture.tokensUsed += (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
    } else if (e.type === 'error' && e.kind === 'fatal') {
      capture.error = e.message;
    }
  });

  const unsubStream = childLog.subscribe((childEvt) =>
    streamChildEventToParent(parentSession, parentTurnId, label, childSessionId, childEvt),
  );

  if (!skipStartEvent) {
    await emitSubagentStart(parentSession, parentTurnId, label, childSessionId, spec, strategyName);
    // Seed the child's log with its user_prompt so projection works for
    // tool-use-style strategies (which read user_prompt events from the log).
    await childLog.append({
      type: 'user_prompt',
      sessionId: childSessionId,
      turnId: childTurnId,
      source: 'user',
      text: spec.prompt,
    });
  }

  try {
    for await (const _ of strategy.run(childCtx)) {
      void _;
    }
  } catch (err) {
    capture.error = err instanceof Error ? err.message : String(err);
  } finally {
    unsubStream();
    unsubCapture();
  }

  const result: SubagentResult = {
    label,
    childSessionId,
    text: capture.text,
    stopReason: capture.error ? ('error' as StopReason) : capture.stopReason,
    ...(capture.error ? { error: { message: capture.error } } : {}),
  };

  if (emitCompleted) {
    await emitSubagentCompleted(
      parentSession,
      parentTurnId,
      label,
      childSessionId,
      capture.text,
      result.stopReason,
      capture.error,
      spec.agentType ?? 'default',
      capture.tokensUsed,
    );
  }

  return { result, tokensUsed: capture.tokensUsed };
}

async function resolveStrategy(
  parentSession: SessionRuntime,
  parentTurnId: TurnId,
  label: string,
  childSessionId: ReturnType<typeof newSessionId>,
  spec: SubagentSpec,
  requestedStrategy: string,
): Promise<ResolvedStrategy> {
  // Look up the requested strategy in the parent's loop registry. The
  // registry only exposes list() / getActive(), so we scan.
  const exact = parentSession.modes.list().find((s) => s.name === requestedStrategy);
  if (exact) return { strategy: exact, strategyName: requestedStrategy };

  // Fall back when the model invented a name (e.g. "react"). Failing the child
  // outright wastes the user's turn — any reasonable agent task can run on the
  // session's current strategy. Prefer a mode literally named "default", then
  // the session's active mode (a host may ship a renamed/alternative default),
  // surfacing the fallback as a non-fatal warning so the operator sees it.
  const fallback =
    parentSession.modes.list().find((s) => s.name === 'default') ??
    safeActiveMode(parentSession);
  if (fallback) {
    await emitSubagentWarning(
      parentSession,
      parentTurnId,
      label,
      childSessionId,
      `unknown mode "${requestedStrategy}" — falling back to "${fallback.name}"`,
    );
    return { strategy: fallback, strategyName: fallback.name };
  }

  // No fallback mode at all — that's a config error, not a model mistake.
  await emitSubagentStart(parentSession, parentTurnId, label, childSessionId, spec, requestedStrategy);
  const errorMsg = `Subagent failed: unknown mode "${requestedStrategy}" and no fallback available`;
  await emitSubagentCompleted(parentSession, parentTurnId, label, childSessionId, '', 'error', errorMsg, spec.agentType ?? 'default', 0);
  return {
    failure: {
      label,
      childSessionId,
      text: '',
      stopReason: 'error' as StopReason,
      error: { message: errorMsg },
    },
  };
}

/** `modes.getActive()` throws when no mode is active; treat that as "no fallback". */
function safeActiveMode(
  parentSession: SessionRuntime,
): ReturnType<SessionRuntime['modes']['list']>[number] | undefined {
  try {
    return parentSession.modes.getActive();
  } catch {
    return undefined;
  }
}

/**
 * Resolve the child's effective model. A `spec.model` usually comes from the
 * calling LLM (dispatch_agent's free-form string field), which sometimes
 * hallucinates training-era ids ("claude-3-5-sonnet", "gpt-4o") — running the
 * child on those would 404 or silently land on a different vendor model. When
 * the active provider publishes a models list and the requested id isn't in
 * it, fall back to the parent's model with a warning (mirroring the
 * unknown-mode fallback above) instead of hard-erroring. Providers with an
 * EMPTY models list (sparse admin-registered vendors — see the
 * resolveModelContext caveat in @moxxy/sdk) skip validation entirely: we
 * can't tell a typo from a legitimate unlisted id there.
 */
async function resolveChildModel(
  rt: SubagentRuntime,
  spec: SubagentSpec,
  label: string,
  childSessionId: ReturnType<typeof newSessionId>,
): Promise<string> {
  const { parentSession, parentTurnId, parentModel } = rt;
  const requested = spec.model;
  if (requested === undefined || requested === parentModel) return parentModel;
  const models = parentSession.providers.getActive().models;
  if (models.length > 0 && !models.some((m) => m.id === requested)) {
    await emitSubagentWarning(
      parentSession,
      parentTurnId,
      label,
      childSessionId,
      `unknown model "${requested}" — falling back to parent model "${parentModel}"`,
    );
    return parentModel;
  }
  return requested;
}

function buildChildContext(
  rt: SubagentRuntime,
  spec: SubagentSpec,
  model: string,
  childSessionId: ReturnType<typeof newSessionId>,
  childTurnId: TurnId,
  toolRegistry: ToolRegistry,
  childLog: EventLog,
  spawner: SubagentSpawner,
): ModeContext {
  const { parentSession, parentSignal } = rt;
  // Children share the parent's working dir + environment — mirror them onto
  // the child ModeContext so its tool dispatcher hands onToolCall hooks the
  // real cwd/env (matching the parent turn) rather than empty placeholders.
  const parentAppCtx = parentSession.appContext();
  return {
    sessionId: childSessionId,
    turnId: childTurnId,
    cwd: parentAppCtx.cwd,
    env: parentAppCtx.env,
    services: parentAppCtx.services,
    model,
    ...(spec.systemPrompt !== undefined ? { systemPrompt: spec.systemPrompt } : {}),
    provider: parentSession.providers.getActive(),
    tools: toolRegistry,
    skills: parentSession.skills,
    log: childLog,
    compactor: parentSession.compactors.getActive(),
    cacheStrategy: parentSession.cacheStrategies.getActive(),
    ...(parentSession.elisionSettings ? { elision: parentSession.elisionSettings } : {}),
    ...(parentSession.lazyTools ? { lazyTools: true } : {}),
    permissions: parentSession.resolver,
    // Intentionally no `approval` — fanning approval gates out to N
    // children in parallel would prompt the user N times. Strategies
    // that absolutely need approval can be invoked at the parent level.
    hooks: parentSession.dispatcher,
    pluginHost: parentSession.pluginHost,
    signal: parentSignal, // child cancels when parent cancels
    maxIterations: spec.maxIterations ?? 50,
    subagents: spawner,
    emit: (event: EmittedEvent): Promise<MoxxyEvent> => childLog.append(event),
  };
}

/**
 * Build an error-bearing {@link SubagentResult} for a spec whose `runChildTurn`
 * threw during setup (before it could degrade the error into a result itself).
 * Keeps `spawnAll` total: one result per spec, in input order, never a thrown
 * batch. The real child id is unknown here (setup failed before it was captured),
 * so a fresh placeholder id is minted; the result still carries the failing
 * spec's label and the error message.
 */
function spawnFailureResult(spec: SubagentSpec, reason: unknown): SubagentResult {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    label: spec.label ?? 'subagent',
    childSessionId: newSessionId(),
    text: '',
    stopReason: 'error' as StopReason,
    error: { message },
  };
}

export function createSubagentSpawner(rt: SubagentRuntime): SubagentSpawner {
  return {
    async spawn(spec) {
      return runChildTurn({ rt, spec, retainSession: spec.retainSession === true });
    },
    async spawnAll(specs) {
      // Per-child degradation: a single child's PRE-`try` setup throw (no active
      // provider, a `compactors.getActive()` config error, a log-append reject in
      // `resolveStrategy`) must NOT reject the whole batch, and must NEVER abort or
      // orphan its still-running siblings (whose later settlement would otherwise
      // surface as an `unhandledRejection`). `Promise.all` short-circuits on the
      // first rejection and leaks the rest — `Promise.allSettled` always waits for
      // every child and never rejects. Each spec yields exactly one result, in
      // input order; a setup throw becomes an error-bearing `SubagentResult` so a
      // fan-out partially succeeds instead of taking the parent turn down with it.
      const outcomes = await Promise.allSettled(
        specs.map((spec) =>
          runChildTurn({ rt, spec, retainSession: spec.retainSession === true }),
        ),
      );
      return outcomes.map((outcome, i): SubagentResult => {
        if (outcome.status === 'fulfilled') return outcome.value;
        // `specs[i]` is always defined here (i indexes the same array we mapped),
        // but `noUncheckedIndexedAccess` widens it to `| undefined`; narrow so the
        // failure result still carries the failing spec's label rather than the
        // generic fallback.
        const spec = specs[i];
        return spawnFailureResult(spec ?? { prompt: '' }, outcome.reason);
      });
    },
    async continue(args: SubagentContinueArgs) {
      return continueChildTurn(args);
    },
    release(childSessionId: SessionId) {
      releaseRetainedChild(childSessionId);
    },
  };
}
