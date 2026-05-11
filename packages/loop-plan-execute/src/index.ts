import {
  asPluginId,
  asToolCallId,
  defineLoopStrategy,
  definePlugin,
  type LoopContext,
  type MoxxyEvent,
  type ProviderEvent,
  type ProviderMessage,
} from '@moxxy/sdk';

export const PLAN_EXECUTE_LOOP_NAME = 'plan-execute';

const PLAN_PLUGIN_ID = asPluginId('@moxxy/loop-plan-execute');

const PLAN_SYSTEM_PROMPT = `Before doing anything, produce a numbered plan of 1-6 short steps. Format strictly:

PLAN:
1. <step>
2. <step>
...

Then stop. The runtime will execute each step as a focused turn.`;

export const planExecuteLoop = defineLoopStrategy({
  name: PLAN_EXECUTE_LOOP_NAME,
  run: runPlanExecuteLoop,
});

export const planExecuteLoopPlugin = definePlugin({
  name: '@moxxy/loop-plan-execute',
  version: '0.0.0',
  loopStrategies: [planExecuteLoop],
});

export default planExecuteLoopPlugin;

async function* runPlanExecuteLoop(ctx: LoopContext): AsyncIterable<MoxxyEvent> {
  if (ctx.signal.aborted) {
    yield await ctx.emit({
      type: 'abort',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      reason: 'aborted before plan',
    });
    return;
  }

  yield await ctx.emit({
    type: 'loop_iteration',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    strategy: PLAN_EXECUTE_LOOP_NAME,
    iteration: 0,
    routing: 'unresolved',
  });

  // Phase 1: produce a plan
  const planText = await collectPlan(ctx);
  if (planText === null) return;
  const steps = parsePlan(planText);

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: PLAN_PLUGIN_ID,
    subtype: 'plan_created',
    payload: { text: planText, steps },
  });

  if (steps.length === 0) {
    // No actionable plan — surface and stop.
    yield await ctx.emit({
      type: 'assistant_message',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'model',
      content: planText,
      stopReason: 'end_turn',
    });
    return;
  }

  // Phase 2: execute each step
  const maxIterationsPerStep = ctx.maxIterations ?? 6;

  for (let i = 0; i < steps.length; i++) {
    if (ctx.signal.aborted) {
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'aborted between steps',
      });
      return;
    }

    yield await ctx.emit({
      type: 'plugin_event',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'plugin',
      pluginId: PLAN_PLUGIN_ID,
      subtype: 'plan_step_started',
      payload: { index: i, step: steps[i]! },
    });

    const completed = await executeStep(ctx, steps[i]!, maxIterationsPerStep);

    yield await ctx.emit({
      type: 'plugin_event',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'plugin',
      pluginId: PLAN_PLUGIN_ID,
      subtype: 'plan_step_completed',
      payload: { index: i, step: steps[i]!, completed },
    });

    if (!completed) {
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'fatal',
        message: `plan-execute: step ${i + 1} did not complete cleanly: "${steps[i]}"`,
      });
      return;
    }
  }

  yield await ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: PLAN_PLUGIN_ID,
    subtype: 'plan_completed',
    payload: { steps: steps.length },
  });
}

async function collectPlan(ctx: LoopContext): Promise<string | null> {
  const userMessages = buildBaseMessages(ctx);
  const planMessages: ProviderMessage[] = [
    {
      role: 'system',
      content: [{ type: 'text', text: PLAN_SYSTEM_PROMPT + (ctx.systemPrompt ? `\n\n${ctx.systemPrompt}` : '') }],
    },
    ...userMessages,
  ];

  await ctx.emit({
    type: 'provider_request',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
  });

  let text = '';
  try {
    for await (const event of ctx.provider.stream({
      model: ctx.model,
      messages: planMessages,
      maxTokens: 1024,
      signal: ctx.signal,
    })) {
      if (event.type === 'text_delta') {
        text += event.delta;
        await ctx.emit({
          type: 'assistant_chunk',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'model',
          delta: event.delta,
        });
      } else if (event.type === 'error') {
        await ctx.emit({
          type: 'error',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          kind: event.retryable ? 'retryable' : 'fatal',
          message: event.message,
        });
        return null;
      }
    }
  } catch (err) {
    await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: 'fatal',
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  await ctx.emit({
    type: 'provider_response',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
  });

  return text;
}

async function executeStep(
  ctx: LoopContext,
  step: string,
  maxIterations: number,
): Promise<boolean> {
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.signal.aborted) return false;

    await ctx.emit({
      type: 'loop_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: PLAN_EXECUTE_LOOP_NAME,
      iteration,
    });

    const messages = buildStepMessages(ctx, step);
    await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    const { text, toolUses, stopReason } = await consume(ctx, messages);

    await ctx.emit({
      type: 'provider_response',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    for (const t of toolUses) {
      await ctx.emit({
        type: 'tool_call_requested',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        callId: asToolCallId(t.id),
        name: t.name,
        input: t.input,
      });
    }

    if (text || stopReason === 'end_turn' || toolUses.length === 0) {
      await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: text,
        stopReason,
      });
    }

    if (stopReason !== 'tool_use' || toolUses.length === 0) return true;

    for (const t of toolUses) {
      const decision = await ctx.permissions.check(
        { callId: asToolCallId(t.id), name: t.name, input: t.input },
        { sessionId: String(ctx.sessionId), toolDescription: ctx.tools.get(t.name)?.description },
      );
      if (decision.mode === 'deny') {
        await ctx.emit({
          type: 'tool_call_denied',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          callId: asToolCallId(t.id),
          decidedBy: 'resolver',
          reason: decision.reason ?? 'denied',
        });
        await ctx.emit({
          type: 'tool_result',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'tool',
          callId: asToolCallId(t.id),
          ok: false,
          error: { kind: 'denied', message: decision.reason ?? 'denied' },
        });
        continue;
      }
      await ctx.emit({
        type: 'tool_call_approved',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        callId: asToolCallId(t.id),
        decidedBy: 'resolver',
        mode: decision.mode,
      });
      try {
        const output = await ctx.tools.execute(t.name, t.input, ctx.signal, {
          callId: t.id,
          sessionId: String(ctx.sessionId),
          turnId: String(ctx.turnId),
          log: ctx.log,
        });
        await ctx.emit({
          type: 'tool_result',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'tool',
          callId: asToolCallId(t.id),
          ok: true,
          output,
        });
      } catch (err) {
        await ctx.emit({
          type: 'tool_result',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'tool',
          callId: asToolCallId(t.id),
          ok: false,
          error: {
            kind: ctx.signal.aborted ? 'aborted' : 'threw',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }
  return false;
}

interface CollectedToolUse {
  id: string;
  name: string;
  input: unknown;
}

interface StreamResult {
  text: string;
  toolUses: CollectedToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
}

async function consume(ctx: LoopContext, messages: ReadonlyArray<ProviderMessage>): Promise<StreamResult> {
  let text = '';
  const toolUses = new Map<string, { name?: string; input?: unknown }>();
  let stopReason: StreamResult['stopReason'] = 'end_turn';

  let stream: AsyncIterable<ProviderEvent>;
  try {
    stream = ctx.provider.stream({
      model: ctx.model,
      messages,
      tools: ctx.tools.list(),
      signal: ctx.signal,
    });
  } catch {
    return { text: '', toolUses: [], stopReason: 'error' };
  }

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta':
        text += event.delta;
        await ctx.emit({
          type: 'assistant_chunk',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'model',
          delta: event.delta,
        });
        break;
      case 'tool_use_start':
        toolUses.set(event.id, { name: event.name });
        break;
      case 'tool_use_end': {
        const existing = toolUses.get(event.id) ?? {};
        toolUses.set(event.id, { ...existing, input: event.input });
        break;
      }
      case 'message_end':
        stopReason = event.stopReason;
        break;
      default:
        break;
    }
  }

  const out: CollectedToolUse[] = [];
  for (const [id, partial] of toolUses) {
    if (!partial.name) continue;
    out.push({ id, name: partial.name, input: partial.input ?? {} });
  }
  return { text, toolUses: out, stopReason };
}

function buildBaseMessages(ctx: LoopContext): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const e of ctx.log.slice()) {
    if (e.type === 'user_prompt') {
      out.push({ role: 'user', content: [{ type: 'text', text: e.text }] });
    }
  }
  return out;
}

function buildStepMessages(ctx: LoopContext, step: string): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  if (ctx.systemPrompt) {
    messages.push({ role: 'system', content: [{ type: 'text', text: ctx.systemPrompt }] });
  }

  let pendingAssistant: ProviderMessage | null = null;
  const flush = (): void => {
    if (pendingAssistant) {
      messages.push(pendingAssistant);
      pendingAssistant = null;
    }
  };

  for (const e of ctx.log.slice()) {
    switch (e.type) {
      case 'user_prompt':
        flush();
        messages.push({ role: 'user', content: [{ type: 'text', text: e.text }] });
        break;
      case 'assistant_message':
        flush();
        messages.push({ role: 'assistant', content: [{ type: 'text', text: e.content }] });
        break;
      case 'tool_call_requested': {
        pendingAssistant ??= { role: 'assistant', content: [] };
        (pendingAssistant.content as Array<ProviderMessage['content'][number]>).push({
          type: 'tool_use',
          id: e.callId,
          name: e.name,
          input: e.input,
        });
        break;
      }
      case 'tool_result': {
        flush();
        const text = e.error
          ? `[error:${e.error.kind}] ${e.error.message}`
          : typeof e.output === 'string'
            ? e.output
            : JSON.stringify(e.output ?? '');
        messages.push({
          role: 'tool_result',
          content: [{ type: 'tool_result', toolUseId: e.callId, content: text, isError: !e.ok }],
        });
        break;
      }
      default:
        break;
    }
  }
  flush();
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: `Focus on this step now: ${step}` }],
  });
  return messages;
}

export function parsePlan(text: string): string[] {
  const lines = text.split('\n');
  const steps: string[] = [];
  let inPlan = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^plan\s*:?$/i.test(line)) {
      inPlan = true;
      continue;
    }
    const m = /^(?:\d+[.)]|[-*•])\s*(.+)$/.exec(line);
    if (m) {
      steps.push(m[1]!.trim());
      inPlan = true;
    } else if (inPlan && steps.length > 0 && !/^[A-Z]/.test(line)) {
      // continuation indented under previous step — skip
    }
  }
  return steps;
}
