import { AGENT_ACCOUNT_LIMIT_SUBTYPE, recordedAccountLimit, sameAccountLimit, withKnownReset } from '../agent-account-limit.js';
import { AGENT_CONTEXT_WINDOW_SUBTYPE, isContextWindowSize, recordedContextWindows } from '../agent-context-window.js';
import { AGENT_NO_REPLY_SUBTYPE } from '../agent-no-reply.js';
import { AGENT_CONNECTION_PLUGIN_ID, AGENT_GOAL_SUBTYPE, AGENT_SESSION_SUBTYPE, SUBAGENTS_PLUGIN_ID, agentSessionFromEvents } from '../agent-step.js';
import {
  AUTO_APPROVE_PLUGIN_ID,
  AUTO_APPROVE_RESTORED_SUBTYPE,
  AUTO_APPROVE_SUBTYPE,
  autoApproveFromAgent,
  autoApproveFromEvents,
  autoApproveRecorded,
} from '../auto-approve.js';
import { renderEarlierConversation, renderMissedTurns } from '../conversation-history.js';
import { computeElisionState } from '../elision-state.js';
import type { MoxxyEvent, UserPromptEvent } from '../events.js';
import { asToolCallId } from '../ids.js';
import type { ModeContext } from '../mode.js';
import type {
  AgentGoalStatus,
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentStepHost,
  AgentToolCall,
  AgentToolOutcome,
  ContentBlock,
  TokenUsage,
} from '../provider.js';
import type { ToolDef } from '../tool.js';
import type { StopReason } from '../provider-utils.js';
import { usageEventFields } from '../token-accounting.js';
import { dispatchToolCall } from '../tool-dispatch.js';
import { addUsage, type CollectedToolUse } from './collect-stream.js';
import { emitAbort, emitError, runCheckpointGate } from './checkpoint-gate.js';
import { projectUserPrompt } from './project-messages.js';
import type { ReactLoopOptions } from './react-loop-options.js';

const DEFAULT_MAX_ITERATIONS = 500;
const DEFAULT_MAX_INJECTIONS = 3;
const DEFAULT_MAX_INJECT_CHARS = 16_384;

/**
 * The loop for an agent connection: each round is one turn of the vendor's
 * agent (`provider.agentStep`), recorded as ordinary events. The mode's policy
 * still applies: `onProviderSuccess` after the turn, `onToolBatchEnd` after the
 * Moxxy tools it called, and the checkpoints that opted into agent
 * connections at the turn-end. Moxxy's own end-of-turn reminders stay out:
 * the agent decides when its turn is done.
 */
export async function* runAgentStepLoop(ctx: ModeContext, opts: ReactLoopOptions): AsyncGenerator<MoxxyEvent, void> {
  if (ctx.isSubagent || turnOrigin(ctx) !== 'agent') {
    yield* runAgentStepRounds(ctx, opts, {});
    return;
  }
  // A turn the agent took up by itself that shows nothing would leave its "Agent continued" marker alone.
  const end: TurnEnd = {};
  let shown = false;
  for await (const event of runAgentStepRounds(ctx, opts, end)) {
    shown ||= showsInChat(event);
    yield event;
  }
  if (shown || end.limitReached) return;
  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    pluginId: AGENT_CONNECTION_PLUGIN_ID,
    subtype: AGENT_NO_REPLY_SUBTYPE,
    payload: {},
  });
}

interface TurnEnd {
  /** The turn stopped on a used-up account limit, which the chat already shows. */
  limitReached?: true;
}

/** Whether the chat shows the event as something the turn did: its words, a tool or helper it ran, or why it stopped. */
function showsInChat(event: MoxxyEvent): boolean {
  switch (event.type) {
    case 'assistant_chunk':
      return event.delta.trim() !== '';
    case 'assistant_message':
      return event.content.trim() !== '';
    case 'tool_call_requested':
    case 'error':
    case 'abort':
      return true;
    case 'plugin_event':
      return event.pluginId === SUBAGENTS_PLUGIN_ID;
    default:
      return false;
  }
}

async function* runAgentStepRounds(ctx: ModeContext, opts: ReactLoopOptions, end: TurnEnd): AsyncGenerator<MoxxyEvent, void> {
  const agentStep = ctx.provider.agentStep;
  if (!agentStep) return;
  if (opts.preflightAbortReason && ctx.signal.aborted) {
    yield await emitAbort(ctx, opts.preflightAbortReason);
    return;
  }
  const checkpoints = ctx.isSubagent ? [] : (opts.checkpoints ?? []).filter((cp) => cp.agentConnections === true);
  const injectionBudget = Math.max(0, Math.floor(opts.maxInjections ?? DEFAULT_MAX_INJECTIONS));
  const maxInjectChars = Math.max(1024, Math.floor(opts.maxInjectChars ?? DEFAULT_MAX_INJECT_CHARS));
  const maxIterations =
    typeof ctx.maxIterations === 'number' && Number.isFinite(ctx.maxIterations)
      ? Math.max(1, Math.floor(ctx.maxIterations))
      : (opts.defaultMaxIterations ?? DEFAULT_MAX_ITERATIONS);
  let prompt = turnPrompt(ctx);
  // A turn the agent started by itself: its first round reads the agent's turn, later rounds send as usual.
  const agentsOwnTurn = turnOrigin(ctx) === 'agent';
  let injectionsUsed = 0;
  let consecutiveIdle = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.signal.aborted) {
      yield await emitAbort(ctx, 'signal aborted');
      return;
    }
    yield await ctx.emit({
      type: 'mode_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: opts.strategyName,
      iteration,
    });
    yield await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    const round = await runRound(ctx, agentStep.bind(ctx.provider), prompt, iteration, opts.strategyName, agentsOwnTurn && iteration === 1);
    yield* round.events;
    if (round.limitReached) end.limitReached = true;

    if (round.endsTurn !== undefined) {
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        stopReason: 'end_turn',
        content: round.endsTurn,
      });
      return;
    }
    if (ctx.signal.aborted) {
      yield await emitAbort(ctx, 'signal aborted during the agent turn');
      return;
    }
    if (round.error) {
      // A reached account limit is already recorded and says why the agent stopped.
      if (!round.limitReached) yield await emitError(ctx, 'fatal', `${opts.errorPrefix ?? ''}${round.error}`);
      return;
    }

    if (opts.onProviderSuccess) {
      const directive = await opts.onProviderSuccess(ctx, {
        text: round.lastText,
        stopReason: round.stopReason,
        toolUses: [],
        ...(round.usage ? { usage: round.usage } : {}),
        iteration,
      });
      if (directive?.action === 'stop') return;
    }
    if (round.goal && opts.onAgentGoal) {
      const directive = await opts.onAgentGoal(ctx, round.goal);
      if (directive?.action === 'stop') return;
    }
    if (round.plan !== undefined) {
      if (opts.onAgentPlan) {
        const directive = await opts.onAgentPlan(ctx, round.plan);
        if (directive?.action === 'stop') return;
      } else {
        yield await ctx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'model',
          content: round.plan,
          stopReason: 'end_turn',
        });
      }
    }
    if (round.moxxyTools.length > 0 && opts.onToolBatchEnd) {
      const directive = await opts.onToolBatchEnd(ctx, { toolUses: round.moxxyTools, iteration });
      if (directive?.action === 'stop') return;
    }
    // A round where the agent ran tools, its own or Moxxy's, is work, not idling.
    if (round.moxxyTools.length > 0 || round.ranTools) {
      consecutiveIdle = 0;
      injectionsUsed = 0;
    } else {
      consecutiveIdle += 1;
    }

    const promptsBefore = ctx.log.ofType('user_prompt').length;
    const verdict = yield* runCheckpointGate(ctx, checkpoints, {
      candidateText: round.lastText,
      stopReason: round.stopReason,
      iteration,
      consecutiveIdle,
      injectionsUsed,
      injectionBudget,
      maxInjectChars,
    });
    if (verdict.kind === 'end') return;
    injectionsUsed += 1;
    // A persistent injection is a checkpoint user_prompt in the log; a volatile one rides this call only.
    const injected = ctx.log.ofType('user_prompt').slice(promptsBefore).at(-1);
    const follow = verdict.volatileText ?? (injected ? injected.text : undefined);
    prompt = follow ? [{ type: 'text', text: follow }] : [{ type: 'text', text: 'Continue.' }];
  }

  if (opts.onMaxIterations) {
    await opts.onMaxIterations(ctx, maxIterations);
    return;
  }
  yield await emitError(ctx, 'fatal', `${opts.strategyName} mode loop exceeded maxIterations (${maxIterations})`);
}

interface Round {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly lastText: string;
  readonly stopReason: StopReason;
  readonly usage?: TokenUsage;
  readonly error?: string;
  /** Moxxy tools the agent called over MCP, for the mode's `onToolBatchEnd`. */
  readonly moxxyTools: ReadonlyArray<CollectedToolUse>;
  /** The agent ran tools of its own. */
  readonly ranTools: boolean;
  /** Set when the person refused a tool whose refusal ends the turn: its text. */
  readonly endsTurn?: string;
  readonly goal?: AgentGoalStatus;
  readonly plan?: string;
  /** The agent reported its account limit reached: the turn ends on that, not on the error it came with. */
  readonly limitReached?: true;
}

async function runRound(
  ctx: ModeContext,
  agentStep: NonNullable<ModeContext['provider']['agentStep']>,
  prompt: ReadonlyArray<ContentBlock>,
  iteration: number,
  mode: string,
  continuesAgentTurn: boolean,
): Promise<Round> {
  const events: MoxxyEvent[] = [];
  const emit = async (event: Parameters<ModeContext['emit']>[0]) => {
    events.push(await ctx.emit(event));
  };
  const base = { sessionId: ctx.sessionId, turnId: ctx.turnId };
  const moxxyTools: CollectedToolUse[] = [];
  const open = new Set<string>();
  // Ending the turn on a refusal stops the agent without it counting as the person's Stop.
  const stopAgent = new AbortController();
  const signal = AbortSignal.any([ctx.signal, stopAgent.signal]);
  let endsTurn: string | undefined;

  const host: AgentStepHost = {
    runTool: async (call) => {
      moxxyTools.push({ id: call.callId, name: call.name, input: call.input });
      await emit({ ...base, type: 'tool_call_requested', source: 'model', callId: asToolCallId(call.callId), name: call.name, input: call.input });
      const outcome = await runMoxxyTool(ctx, call, iteration, mode, (event) => events.push(event));
      if (!outcome.ok && outcome.endsTurn) {
        endsTurn = ctx.tools.get(call.name)?.refusalEndsTurn;
        stopAgent.abort();
      }
      return outcome;
    },
    approve: (request) => approveAgentTool(ctx, request, iteration, (event) => events.push(event)),
    ask: (questions) => (ctx.ask ? ctx.ask(questions) : Promise.resolve({ kind: 'unanswerable' as const })),
  };

  const resumeSessionId = agentSessionFromEvents(ctx.log.ofType('plugin_event'), ctx.provider.name);
  let autoApprove = autoApproveFromEvents(ctx.log.ofType('plugin_event'));
  let lastText = '';
  let stopReason: StopReason = 'end_turn';
  let usage: TokenUsage | undefined;
  // How full the agent's context is: what it says, else the prompt of its last call.
  let contextTokens: number | undefined;
  let reportsContext = false;
  let error: string | undefined;
  let sessionId = resumeSessionId;
  let goal: AgentGoalStatus | undefined;
  let plan: string | undefined;
  let limit = recordedAccountLimit(ctx.log.ofType('plugin_event'), ctx.provider.name)?.limit;
  let limitReached = false;
  const windows = new Map(recordedContextWindows(ctx.log.ofType('plugin_event'), ctx.provider.name));
  /** The agent's own subagents started in this step, to name them in their later events (one started in an earlier turn goes unnamed). */
  const subagents = new Map<string, { readonly label: string; readonly agentType: string }>();
  let ranTools = false;

  try {
    const stream = agentStep({
      sessionId: String(ctx.sessionId),
      model: ctx.model,
      prompt,
      cwd: ctx.cwd,
      mode,
      tools: ctx.tools.list(),
      allTools: everyTool(ctx),
      skills: ctx.skills.list(),
      ...(resumeSessionId ? { resumeSessionId } : {}),
      earlierConversation: () => renderEarlierConversation(ctx.log, ctx.turnId),
      missedTurns: () => renderMissedTurns(ctx.log, ctx.provider.name, ctx.turnId),
      autoApprove,
      autoApproveRecorded: autoApproveRecorded(ctx.log.ofType('plugin_event')),
      autoApproveFromAgent: autoApproveFromAgent(ctx.log.ofType('plugin_event')),
      ...(ctx.reasoning ? { reasoning: ctx.reasoning } : {}),
      ...(ctx.fast ? { fast: true } : {}),
      signal,
      host,
      ...(continuesAgentTurn ? { continuesAgentTurn: true as const } : {}),
    });
    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta':
          await emit({ ...base, type: 'assistant_chunk', source: 'model', delta: event.delta });
          break;
        case 'reasoning_delta':
          await emit({ ...base, type: 'reasoning_chunk', source: 'model', delta: event.delta });
          break;
        case 'message':
          lastText = event.text;
          stopReason = event.stopReason ?? 'end_turn';
          await emit({ ...base, type: 'assistant_message', source: 'model', content: event.text, stopReason });
          break;
        case 'reasoning':
          await emit({ ...base, type: 'reasoning_message', source: 'model', content: event.text });
          break;
        case 'tool_call':
          open.add(event.callId);
          ranTools = true;
          await emit({
            ...base,
            type: 'tool_call_requested',
            source: 'model',
            callId: asToolCallId(event.callId),
            name: event.name,
            input: event.input,
            executedBy: 'provider',
          });
          break;
        case 'tool_result':
          open.delete(event.callId);
          await emit({
            ...base,
            type: 'tool_result',
            source: 'tool',
            callId: asToolCallId(event.callId),
            ok: event.ok,
            ...(event.ok ? { output: event.output } : { error: { kind: 'threw' as const, message: event.error ?? 'the tool failed' } }),
          });
          break;
        case 'session':
          if (event.sessionId !== sessionId) {
            sessionId = event.sessionId;
            await emit({
              ...base,
              type: 'plugin_event',
              source: 'system',
              pluginId: AGENT_CONNECTION_PLUGIN_ID,
              subtype: AGENT_SESSION_SUBTYPE,
              payload: { provider: ctx.provider.name, sessionId: event.sessionId },
            });
          }
          break;
        case 'auto_approve':
          if (event.enabled !== autoApprove) {
            autoApprove = event.enabled;
            await emit({
              ...base,
              type: 'plugin_event',
              source: 'system',
              pluginId: AUTO_APPROVE_PLUGIN_ID,
              subtype: AUTO_APPROVE_SUBTYPE,
              payload: { enabled: event.enabled, ...(event.elsewhere ? { elsewhere: true } : {}) },
            });
          }
          break;
        case 'auto_approve_restored':
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'system',
            pluginId: AUTO_APPROVE_PLUGIN_ID,
            subtype: AUTO_APPROVE_RESTORED_SUBTYPE,
            payload: { provider: ctx.provider.name },
          });
          break;
        case 'goal':
          goal = event.status;
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'system',
            pluginId: AGENT_CONNECTION_PLUGIN_ID,
            subtype: AGENT_GOAL_SUBTYPE,
            payload: { provider: ctx.provider.name, status: event.status },
          });
          break;
        case 'plan':
          plan = event.text;
          break;
        case 'account_limit': {
          if (event.limit.state === 'reached') limitReached = true;
          const reading = withKnownReset(event.limit, limit, Date.now());
          if (sameAccountLimit(limit, reading)) break;
          limit = reading;
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'system',
            pluginId: AGENT_CONNECTION_PLUGIN_ID,
            subtype: AGENT_ACCOUNT_LIMIT_SUBTYPE,
            payload: { provider: ctx.provider.name, ...(ctx.provider.agentName ? { agent: ctx.provider.agentName } : {}), limit: reading },
          });
          break;
        }
        case 'context_window':
          if (!isContextWindowSize(event.tokens) || windows.get(event.model) === event.tokens) break;
          windows.set(event.model, event.tokens);
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'system',
            pluginId: AGENT_CONNECTION_PLUGIN_ID,
            subtype: AGENT_CONTEXT_WINDOW_SUBTYPE,
            payload: { provider: ctx.provider.name, model: event.model, tokens: event.tokens },
          });
          break;
        case 'subagent_started':
          subagents.set(event.id, { label: event.label, agentType: event.agentType });
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'plugin',
            pluginId: SUBAGENTS_PLUGIN_ID,
            subtype: 'subagent_started',
            payload: {
              childSessionId: event.id,
              label: event.label,
              agentType: event.agentType,
              ...(event.prompt ? { prompt: event.prompt } : {}),
              ...(event.toolsUnseen ? { toolsUnseen: true } : {}),
            },
          });
          break;
        case 'subagent_tool_call': {
          const sub = subagents.get(event.id);
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'plugin',
            pluginId: SUBAGENTS_PLUGIN_ID,
            subtype: 'subagent_tool_call',
            payload: { childSessionId: event.id, ...(sub ? { label: sub.label } : {}), name: event.name, input: event.input },
          });
          break;
        }
        case 'subagent_completed': {
          const sub = subagents.get(event.id);
          await emit({
            ...base,
            type: 'plugin_event',
            source: 'plugin',
            pluginId: SUBAGENTS_PLUGIN_ID,
            subtype: 'subagent_completed',
            payload: {
              childSessionId: event.id,
              ...(sub ? { label: sub.label, agentType: sub.agentType } : {}),
              text: event.text,
              stopReason: event.error ? 'error' : 'end_turn',
              ...(event.tokensUsed !== undefined ? { tokensUsed: event.tokensUsed } : {}),
              ...(event.error ? { error: event.error } : {}),
            },
          });
          break;
        }
        case 'usage':
          usage = usage ? addUsage(usage, event.usage) : event.usage;
          if (!reportsContext) contextTokens = promptTokens(event.usage);
          break;
        case 'context_used':
          reportsContext = true;
          contextTokens = event.tokens;
          break;
        case 'error':
          error = event.message;
          break;
      }
    }
  } catch (err) {
    if (!signal.aborted) error = err instanceof Error ? err.message : String(err);
  }

  // The log never ends on a tool call without its result.
  for (const callId of open) {
    await emit({
      ...base,
      type: 'tool_result',
      source: 'tool',
      callId: asToolCallId(callId),
      ok: false,
      error: signal.aborted
        ? { kind: 'aborted', message: 'turn stopped before the agent finished this tool' }
        : { kind: 'threw', message: 'the agent did not report how this tool ended' },
    });
  }
  await emit({
    ...base,
    type: 'provider_response',
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
    ...usageEventFields(usage),
    ...(usage && contextTokens !== undefined ? { contextTokens } : {}),
  });

  return {
    events,
    lastText,
    stopReason,
    ...(usage ? { usage } : {}),
    ...(error !== undefined ? { error } : {}),
    moxxyTools,
    ranTools,
    ...(endsTurn !== undefined ? { endsTurn } : {}),
    ...(goal ? { goal } : {}),
    ...(plan !== undefined ? { plan } : {}),
    ...(limitReached ? { limitReached: true as const } : {}),
  };
}

function notOfferedHere(name: string, mode: string): string {
  const question = name === 'ask_user' ? ' Nobody is there to answer questions: pick the sensible choice yourself and say which one you picked.' : '';
  return `${name} is not available in ${mode} mode, so Moxxy did not run it. Carry on without it.${question}`;
}

/** The session's tools in any mode, with those this turn's mode adds for itself (plan mode's `plan_complete`). */
function everyTool(ctx: ModeContext): ToolDef[] {
  const turn = ctx.tools.list();
  if (!ctx.allTools) return [...turn];
  const names = new Set(turn.map((tool) => tool.name));
  return [...ctx.allTools.list().filter((tool) => !names.has(tool.name)), ...turn];
}

/** A Moxxy tool the agent called: the same hooks, permissions, run and log as any tool call. */
async function runMoxxyTool(
  ctx: ModeContext,
  call: AgentToolCall,
  iteration: number,
  mode: string,
  record: (event: MoxxyEvent) => void,
): Promise<AgentToolOutcome> {
  // The agent sees every tool of the conversation (it reads the list once); this mode may not offer this one.
  if (ctx.allTools?.get(call.name) && !ctx.tools.get(call.name)) {
    const message = notOfferedHere(call.name, mode);
    record(
      await ctx.emit({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'tool_result',
        source: 'tool',
        callId: asToolCallId(call.callId),
        ok: false,
        error: { kind: 'denied', message },
      }),
    );
    return { ok: false, message };
  }
  let result: MoxxyEvent | undefined;
  let refused = false;
  for await (const event of dispatchToolCall(ctx, { id: call.callId, name: call.name, input: call.input }, iteration)) {
    record(event);
    if (event.type === 'tool_call_denied' && event.decidedBy === 'resolver') refused = true;
    if (event.type === 'tool_result') result = event;
  }
  if (result && result.type === 'tool_result' && result.ok) return { ok: true, output: result.output };
  const message = result && result.type === 'tool_result' && result.error ? result.error.message : 'the tool failed';
  const endsTurn = refused && ctx.tools.get(call.name)?.refusalEndsTurn !== undefined;
  return { ok: false, message, ...(endsTurn ? { endsTurn: true } : {}) };
}

/** May the agent run one of its own tools? Hooks, then the person (unless policy only), then standing rules. */
async function approveAgentTool(
  ctx: ModeContext,
  request: AgentApprovalRequest,
  iteration: number,
  record: (event: MoxxyEvent) => void,
): Promise<AgentApprovalDecision> {
  const call = { callId: asToolCallId(request.callId), name: request.name, input: request.input };
  const scope = { sessionId: String(ctx.sessionId), turnId: String(ctx.turnId) };
  const deny = async (reason: string, decidedBy: 'hook' | 'resolver' | 'policy'): Promise<AgentApprovalDecision> => {
    record(
      await ctx.emit({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'tool_call_denied',
        source: 'system',
        callId: call.callId,
        decidedBy,
        reason,
      }),
    );
    return { allow: false, reason };
  };

  const verdict = await ctx.hooks.dispatchToolCall({
    sessionId: ctx.sessionId,
    cwd: ctx.cwd,
    log: ctx.log,
    env: ctx.env,
    services: ctx.services,
    turnId: ctx.turnId,
    iteration,
    call,
  });
  if (verdict.action === 'deny') return deny(verdict.reason, 'hook');

  if (!request.policyOnly) {
    const decision = await ctx.permissions.check(call, {
      ...scope,
      toolDescription: request.description ?? ctx.tools.get(request.name)?.description,
      ...(request.askPerson ? { askPerson: true } : {}),
    });
    if (decision.mode === 'deny') {
      const standing = await ctx.permissions.policyCheck?.(call, scope);
      return deny(decision.reason ?? 'denied by resolver', standing?.mode === 'deny' ? 'policy' : 'resolver');
    }
    const always = decision.mode !== 'allow';
    const mandatory = await ctx.permissions.mandatoryCheck?.(call, scope);
    if (mandatory?.mode === 'deny') return deny(mandatory.reason ?? 'workflow approval denied', 'resolver');
    const policy = await ctx.permissions.policyCheck?.(call, scope);
    if (policy?.mode === 'deny') return deny(policy.reason ?? 'denied by policy', 'policy');
    record(
      await ctx.emit({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        type: 'tool_call_approved',
        source: 'system',
        callId: call.callId,
        decidedBy: 'resolver',
        mode: decision.mode,
        ...(decision.decidedNow ? { decidedNow: true } : {}),
      }),
    );
    return always ? { allow: true, always: true } : { allow: true };
  }
  const policy = await ctx.permissions.policyCheck?.(call, scope);
  if (policy?.mode === 'deny') return deny(policy.reason ?? 'denied by policy', 'policy');
  return { allow: true };
}

function turnOrigin(ctx: ModeContext): string | undefined {
  const prompts = ctx.log.ofType('user_prompt') as ReadonlyArray<UserPromptEvent>;
  const mine = prompts.filter((p) => p.turnId === ctx.turnId && p.origin?.kind !== 'checkpoint').at(-1);
  return mine && mine.origin ? mine.origin.kind : undefined;
}

/** The person's message for this turn, as the agent should get it (text, images, documents). */
function turnPrompt(ctx: ModeContext): ReadonlyArray<ContentBlock> {
  const prompts = ctx.log.ofType('user_prompt') as ReadonlyArray<UserPromptEvent>;
  const mine = prompts.filter((p) => p.turnId === ctx.turnId).at(-1);
  if (!mine) return [{ type: 'text', text: '' }];
  return projectUserPrompt(mine, computeElisionState([]));
}

function promptTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheCreationTokens ?? 0);
}
