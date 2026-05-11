import {
  asToolCallId,
  defineLoopStrategy,
  definePlugin,
  type LoopContext,
  type MoxxyEvent,
  type ProviderEvent,
  type ProviderMessage,
  type ToolCallVerdict,
} from '@moxxy/sdk';

export const TOOL_USE_LOOP_NAME = 'tool-use';

export interface CollectedToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export const toolUseLoop = defineLoopStrategy({
  name: TOOL_USE_LOOP_NAME,
  run: runToolUseLoop,
});

export const toolUseLoopPlugin = definePlugin({
  name: '@moxxy/loop-tool-use',
  version: '0.0.0',
  loopStrategies: [toolUseLoop],
});

export default toolUseLoopPlugin;

async function* runToolUseLoop(ctx: LoopContext): AsyncIterable<MoxxyEvent> {
  const maxIterations = ctx.maxIterations ?? 50;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.signal.aborted) {
      yield await ctx.emit({
        type: 'abort',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        reason: 'signal aborted',
      });
      return;
    }

    yield await ctx.emit({
      type: 'loop_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: TOOL_USE_LOOP_NAME,
      iteration,
    });

    const messages = buildMessages(ctx);
    yield await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    const { text, toolUses, stopReason, error } = await consumeStream(ctx, messages);

    yield await ctx.emit({
      type: 'provider_response',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: ctx.provider.name,
      model: ctx.model,
    });

    if (error) {
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: error.retryable ? 'retryable' : 'fatal',
        message: error.message,
      });
      if (!error.retryable) return;
      continue;
    }

    for (const t of toolUses) {
      const callId = asToolCallId(t.id);
      const requested = await ctx.emit({
        type: 'tool_call_requested',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        callId,
        name: t.name,
        input: t.input,
      });
      yield requested;
    }

    if (text || stopReason === 'end_turn' || toolUses.length === 0) {
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: text,
        stopReason,
      });
    }

    if (stopReason !== 'tool_use' || toolUses.length === 0) return;

    for (const t of toolUses) {
      if (ctx.signal.aborted) {
        yield await ctx.emit({
          type: 'abort',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          reason: 'signal aborted during tool execution',
        });
        return;
      }

      const verdict = await ctx.hooks.dispatchToolCall({
        sessionId: ctx.sessionId,
        cwd: '',
        log: ctx.log,
        env: {},
        turnId: ctx.turnId,
        iteration,
        call: { callId: asToolCallId(t.id), name: t.name, input: t.input },
      });
      let actualInput = t.input;
      if (verdict.action === 'rewrite') actualInput = verdict.input;

      const denyReason = hookDeny(verdict);
      if (denyReason) {
        yield await emitDenied(ctx, t, denyReason, 'hook');
        continue;
      }

      const decision = await ctx.permissions.check(
        { callId: asToolCallId(t.id), name: t.name, input: actualInput },
        { sessionId: String(ctx.sessionId), toolDescription: ctx.tools.get(t.name)?.description },
      );
      if (decision.mode === 'deny') {
        yield await emitDenied(ctx, t, decision.reason ?? 'denied by resolver', 'resolver');
        continue;
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
    }
  }

  yield await ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind: 'fatal',
    message: `tool-use loop exceeded maxIterations (${maxIterations})`,
  });
}

function buildMessages(ctx: LoopContext): ReadonlyArray<ProviderMessage> {
  // Defer to core's selectMessages by importing through a small adapter.
  // To keep this package free of @moxxy/core, we re-implement the projection here
  // — but we keep it simple by reading from the log directly.
  const messages: ProviderMessage[] = [];
  if (ctx.systemPrompt) {
    messages.push({ role: 'system', content: [{ type: 'text', text: ctx.systemPrompt }] });
  }

  let pendingAssistant: ProviderMessage | null = null;
  const flushAssistant = (): void => {
    if (pendingAssistant) {
      messages.push(pendingAssistant);
      pendingAssistant = null;
    }
  };

  for (const e of ctx.log.slice()) {
    switch (e.type) {
      case 'user_prompt': {
        flushAssistant();
        messages.push({ role: 'user', content: [{ type: 'text', text: e.text }] });
        break;
      }
      case 'assistant_message': {
        flushAssistant();
        messages.push({ role: 'assistant', content: [{ type: 'text', text: e.content }] });
        break;
      }
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
        flushAssistant();
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
  flushAssistant();
  return messages;
}

interface StreamResult {
  text: string;
  toolUses: CollectedToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
  error: { message: string; retryable: boolean } | null;
}

async function consumeStream(
  ctx: LoopContext,
  messages: ReadonlyArray<ProviderMessage>,
): Promise<StreamResult> {
  const req = {
    model: ctx.model,
    system: ctx.systemPrompt,
    messages,
    tools: ctx.tools.list(),
    signal: ctx.signal,
  };
  const transformed = await ctx.hooks.dispatchBeforeProviderCall(req, {
    sessionId: ctx.sessionId,
    cwd: '',
    log: ctx.log,
    env: {},
    turnId: ctx.turnId,
    iteration: 0,
  });

  let text = '';
  const toolUses = new Map<string, { name?: string; input?: unknown }>();
  let stopReason: StreamResult['stopReason'] = 'end_turn';
  let error: StreamResult['error'] = null;

  let stream: AsyncIterable<ProviderEvent>;
  try {
    stream = ctx.provider.stream(transformed);
  } catch (err) {
    return {
      text: '',
      toolUses: [],
      stopReason: 'error',
      error: { message: err instanceof Error ? err.message : String(err), retryable: false },
    };
  }

  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          text += event.delta;
          await ctx.emit({
            type: 'assistant_chunk',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'model',
            delta: event.delta,
          });
          break;
        }
        case 'tool_use_start': {
          toolUses.set(event.id, { name: event.name });
          break;
        }
        case 'tool_use_end': {
          const existing = toolUses.get(event.id) ?? {};
          toolUses.set(event.id, { ...existing, input: event.input });
          break;
        }
        case 'message_end': {
          stopReason = event.stopReason;
          break;
        }
        case 'error': {
          error = { message: event.message, retryable: event.retryable };
          break;
        }
        case 'message_start':
        case 'tool_use_delta':
        default:
          break;
      }
    }
  } catch (err) {
    error = {
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }

  const finalToolUses: CollectedToolUse[] = [];
  for (const [id, partial] of toolUses) {
    if (!partial.name) continue;
    finalToolUses.push({ id, name: partial.name, input: partial.input ?? {} });
  }
  return { text, toolUses: finalToolUses, stopReason, error };
}

function hookDeny(verdict: ToolCallVerdict): string | null {
  return verdict.action === 'deny' ? verdict.reason : null;
}

async function emitDenied(
  ctx: LoopContext,
  t: CollectedToolUse,
  reason: string,
  by: 'hook' | 'resolver' | 'policy',
): Promise<MoxxyEvent> {
  await ctx.emit({
    type: 'tool_call_denied',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    callId: asToolCallId(t.id),
    decidedBy: by,
    reason,
  });
  return await ctx.emit({
    type: 'tool_result',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'tool',
    callId: asToolCallId(t.id),
    ok: false,
    error: { kind: 'denied', message: reason },
  });
}
