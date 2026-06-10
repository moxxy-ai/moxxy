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
  EventLogReader,
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
  getRetainedChild,
  registerRetainedChild,
  releaseRetainedChild,
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

  const toolRegistry: ToolRegistry =
    spec.allowedTools && spec.allowedTools.length > 0
      ? buildFilteredToolRegistry(parentSession.tools, new Set(spec.allowedTools))
      : (parentSession.tools as unknown as ToolRegistry);

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
    registerRetainedChild({
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
    });
  }

  return capture.result;
}

export async function continueChildTurn(args: {
  childSessionId: SessionId;
  prompt: string;
  label?: string;
}): Promise<SubagentResult> {
  const retained = getRetainedChild(args.childSessionId);
  if (!retained) {
    throw new Error(`no retained subagent session for "${String(args.childSessionId)}"`);
  }

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
    parentSignal: retained.childCtx.signal,
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
  });

  releaseRetainedChild(args.childSessionId);
  return capture.result;
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
}): Promise<{ result: SubagentResult }> {
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
  } = args;
  const { parentSession, parentTurnId } = rt;

  const capture = { text: '', stopReason: 'end_turn' as StopReason, error: null as string | null };

  const unsubCapture = childLog.subscribe((e) => {
    if (e.type === 'assistant_message') {
      if (e.content) capture.text = e.content;
      if (e.stopReason) capture.stopReason = e.stopReason;
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
    );
  }

  return { result };
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

  // Fall back to the default mode if the model invented a name
  // (e.g. "react"). Failing the child outright wastes the user's turn —
  // any reasonable agent task can run on the default mode. We surface the
  // fallback as a non-fatal warning event so the operator sees it.
  const fallback = parentSession.modes.list().find((s) => s.name === 'default');
  if (fallback) {
    await emitSubagentWarning(
      parentSession,
      parentTurnId,
      label,
      childSessionId,
      `unknown mode "${requestedStrategy}" — falling back to "default"`,
    );
    return { strategy: fallback, strategyName: 'default' };
  }

  // No default mode either — that's a config error, not a model mistake.
  await emitSubagentStart(parentSession, parentTurnId, label, childSessionId, spec, requestedStrategy);
  const errorMsg = `Subagent failed: unknown mode "${requestedStrategy}" and no fallback available`;
  await emitSubagentCompleted(parentSession, parentTurnId, label, childSessionId, '', 'error', errorMsg);
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
  return {
    sessionId: childSessionId,
    turnId: childTurnId,
    model,
    ...(spec.systemPrompt !== undefined ? { systemPrompt: spec.systemPrompt } : {}),
    provider: parentSession.providers.getActive(),
    tools: toolRegistry,
    skills: parentSession.skills,
    log: childLog as unknown as EventLogReader,
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

export function createSubagentSpawner(rt: SubagentRuntime): SubagentSpawner {
  return {
    async spawn(spec) {
      return runChildTurn({ rt, spec, retainSession: spec.retainSession === true });
    },
    async spawnAll(specs) {
      return Promise.all(
        specs.map((s) => runChildTurn({ rt, spec: s, retainSession: s.retainSession === true })),
      );
    },
    async continue(args: SubagentContinueArgs) {
      return continueChildTurn(args);
    },
    release(childSessionId: SessionId) {
      releaseRetainedChild(childSessionId);
    },
  };
}
