import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { definePlugin, defineTool, type ProviderEvent } from '@moxxy/sdk';
import { Session, autoAllowResolver, collectTurn, silentLogger } from '@moxxy/core';
import { FakeProvider, textReply, toolUseReply, createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from './index.js';
import { MAX_CONSECUTIVE_RETRIES, __setRetrySleepForTests } from './turn-iterator.js';

/** A scripted provider reply that surfaces a retryable error (e.g. a 429). */
const retryableErrorReply = (message = 'rate limited (429)'): ReadonlyArray<ProviderEvent> => [
  { type: 'message_start', model: 'fake' },
  { type: 'error', message, retryable: true },
  { type: 'message_end', stopReason: 'end_turn' },
];

/**
 * A scripted reply mimicking the real provider stack when the user aborts WHILE
 * the stream is being consumed: the fetch AbortError is caught and classified
 * non-retryable with the canonical "operation was aborted" message.
 */
const abortDuringStreamReply = (): ReadonlyArray<ProviderEvent> => [
  { type: 'message_start', model: 'fake' },
  { type: 'error', message: 'The operation was aborted', retryable: false },
  { type: 'message_end', stopReason: 'end_turn' },
];

/** A reply with no text, no tools, and a non-natural stop (truncated to empty). */
const emptyMaxTokensReply = (): ReadonlyArray<ProviderEvent> => [
  { type: 'message_start', model: 'fake' },
  { type: 'message_end', stopReason: 'max_tokens' },
];

const sessionWith = (provider: FakeProvider): Session => {
  const session = createFakeSession({ provider });
  session.pluginHost.registerStatic(defaultModePlugin);
  return session;
};

describe('defaultMode end-to-end', () => {
  it('runs a plain text turn and emits the expected event sequence', async () => {
    const provider = new FakeProvider({ script: [textReply('hello there')] });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi');
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      'user_prompt',
      'mode_iteration',
      'provider_request',
      'assistant_chunk',
      'provider_response',
      'assistant_message',
    ]);
    const last = events[events.length - 1];
    if (last.type !== 'assistant_message') throw new Error('expected assistant_message last');
    expect(last.content).toBe('hello there');
    expect(last.stopReason).toBe('end_turn');
  });

  it('runs tool_use then continues loop with the result', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('echo', { msg: 'world' }, 'c1'), textReply('done: world')],
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'echo',
        description: 'returns msg',
        inputSchema: z.object({ msg: z.string() }),
        handler: (i) => i.msg,
      }),
    );

    const events = await collectTurn(session, 'go');
    const toolResult = events.find((e) => e.type === 'tool_result');
    if (toolResult?.type !== 'tool_result') throw new Error('expected tool_result');
    expect(toolResult.ok).toBe(true);
    expect(toolResult.output).toBe('world');

    const last = events[events.length - 1];
    if (last.type !== 'assistant_message') throw new Error('expected assistant_message last');
    expect(last.content).toBe('done: world');
  });

  it('records denial when permission resolver says no', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('Bash', { command: 'rm -rf /' }, 'c1'), textReply('aborted')],
    });
    const session = new Session({
      cwd: '/tmp',
      logger: silentLogger,
      permissionResolver: { name: 'deny', async check() { return { mode: 'deny', reason: 'no shells' }; } },
    });
    session.pluginHost.registerStatic({
      __moxxy: 'plugin' as const,
      name: 'shim',
      version: '0.0.0',
      providers: [
        {
          name: provider.name,
          models: [...provider.models],
          createClient: () => provider,
        },
      ],
    });
    session.providers.setActive(provider.name);
    session.pluginHost.registerStatic(defaultModePlugin);
    session.tools.register(
      defineTool({
        name: 'Bash',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        handler: () => 'should not run',
      }),
    );

    const events = await collectTurn(session, 'do it');
    const denied = events.find((e) => e.type === 'tool_call_denied');
    expect(denied).toBeDefined();
    const result = events.find((e) => e.type === 'tool_result');
    if (result?.type !== 'tool_result') throw new Error('expected tool_result');
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('denied');
  });

  it('handles tool handler throws as failure result', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('boom', {}, 'c1'), textReply('recovered')],
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'boom',
        description: '',
        inputSchema: z.object({}),
        handler: () => {
          throw new Error('explode');
        },
      }),
    );

    const events = await collectTurn(session, 'go');
    const result = events.find((e) => e.type === 'tool_result');
    if (result?.type !== 'tool_result') throw new Error('expected tool_result');
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('threw');
    expect(result.error?.message).toContain('explode');
  });

  it('aborts via stuck-loop detector when the model hammers the same call', async () => {
    // The detector fires when the same (name, input) pair appears
    // REPEAT_THRESHOLD times in the last WINDOW calls. A scripted
    // provider that returns the same toolUse over and over is the
    // canonical stuck-loop pattern — bail before burning the soft
    // maxIterations cap.
    const provider = new FakeProvider({
      script: Array(20).fill(toolUseReply('loop', {}, 'cN')),
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'loop',
        description: '',
        inputSchema: z.object({}),
        handler: () => 'ok',
      }),
    );
    void autoAllowResolver;

    const events = await collectTurn(session, 'spin');
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    if (errors[0]?.type !== 'error') throw new Error();
    expect(errors[0].message).toMatch(/stuck pattern/);
    // And the safety-net cap is still wired — exercise its message
    // path by counting outgoing tool calls. The detector should fire
    // around iteration 3, well below the 500-iteration cap.
    const toolCalls = events.filter((e) => e.type === 'tool_call_requested');
    expect(toolCalls.length).toBeLessThan(10);
    // Regression: a stuck trip must NOT leave an orphan tool_call_requested.
    // The detector fires AFTER the final request is emitted but the turn ends
    // before executeToolUses runs it — without synthesizing a result, that
    // request renders as a tool stuck "running" forever (and the provider
    // rejects it next turn). Every emitted request must have a paired result.
    const results = events.filter((e) => e.type === 'tool_result');
    expect(results.length).toBe(toolCalls.length);
  });

  it('emits a paired result for every request even when the stuck loop trips', async () => {
    // Distinct callIds per turn so the assertion is per-call, mirroring how the
    // desktop fold (pair-events) matches tool_result back to tool_call_requested
    // by callId. A leftover orphan here is the exact "tool spins forever, flips
    // to error on the next message" symptom.
    const provider = new FakeProvider({
      script: Array.from({ length: 20 }, (_, i) => toolUseReply('loop', {}, `c${i}`)),
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'loop',
        description: '',
        inputSchema: z.object({}),
        handler: () => 'ok',
      }),
    );

    const events = await collectTurn(session, 'spin');
    const requestedIds = new Set(
      events.filter((e) => e.type === 'tool_call_requested').map((e) => e.callId),
    );
    const resolvedIds = new Set(
      events.filter((e) => e.type === 'tool_result').map((e) => e.callId),
    );
    // No requested call may be left without a result.
    const orphans = [...requestedIds].filter((id) => !resolvedIds.has(id));
    expect(orphans).toEqual([]);
  });

  it('respects an explicit maxIterations cap when no stuck loop fires', async () => {
    // To hit the cap without tripping the detector, vary the input
    // each iteration so the recent-calls window never sees a repeat.
    const script = Array.from({ length: 60 }, (_, i) =>
      toolUseReply('vary', { i }, `c${i}`),
    );
    const provider = new FakeProvider({ script });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'vary',
        description: '',
        inputSchema: z.object({ i: z.number() }),
        handler: () => 'ok',
      }),
    );
    void autoAllowResolver;

    const events = await collectTurn(session, 'spin', { maxIterations: 3 });
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    if (errors[0]?.type !== 'error') throw new Error();
    expect(errors[0].message).toMatch(/maxIterations/);
  });

  it('executes tools even when provider reports stopReason: end_turn', async () => {
    // Regression for the codex provider bug where Responses-API turns with
    // tool calls were reported as `stop_reason: end_turn`. The loop must
    // execute tools whenever they're requested, regardless of stopReason —
    // otherwise a single provider mis-mapping leaves orphan
    // tool_call_requested events and a stuck-looking pending dot.
    const provider = new FakeProvider({
      script: [
        [
          { type: 'message_start', model: 'fake' },
          { type: 'tool_use_start', id: 'c1', name: 'echo' },
          { type: 'tool_use_end', id: 'c1', input: { msg: 'hi' } },
          // Note: end_turn, NOT tool_use — the bug scenario.
          { type: 'message_end', stopReason: 'end_turn' },
        ],
        textReply('done'),
      ],
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'echo',
        description: 'returns msg',
        inputSchema: z.object({ msg: z.string() }),
        handler: (i) => i.msg,
      }),
    );

    const events = await collectTurn(session, 'go');
    const requested = events.find((e) => e.type === 'tool_call_requested');
    const result = events.find((e) => e.type === 'tool_result');
    expect(requested).toBeDefined();
    expect(result).toBeDefined();
    if (result?.type !== 'tool_result') throw new Error('expected tool_result');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('hi');
  });

  it('delivers hook-injected req.system to the provider without duplicating the system prompt', async () => {
    const provider = new FakeProvider({ script: [textReply('ok')] });
    const session = sessionWith(provider);
    // The plugin-memory consolidation-nudge pattern: an onBeforeProviderCall
    // hook appends to req.system. This must reach the provider request —
    // previously the loop prefilled req.system with the system prompt and
    // every provider dropped the field, so hook injections vanished.
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@moxxy/test-nudge',
        version: '0.0.0',
        hooks: {
          onBeforeProviderCall: (req) => ({
            ...req,
            system: (req.system ?? '') + '[memory note] consider consolidating',
          }),
        },
      }),
    );

    await collectTurn(session, 'hi', { systemPrompt: 'BASE PROMPT' });

    expect(provider.received).toHaveLength(1);
    const req = provider.received[0]!;
    // The hook saw an UNSET req.system (no duplicated prompt) and its
    // injection arrived verbatim.
    expect(req.system).toBe('[memory note] consider consolidating');
    // The composed system prompt still rides as the leading system message.
    const first = req.messages[0]!;
    expect(first.role).toBe('system');
    expect(first.content[0]).toMatchObject({ type: 'text', text: 'BASE PROMPT' });
  });

  it('leaves req.system unset when no hook injects system text', async () => {
    const provider = new FakeProvider({ script: [textReply('ok')] });
    const session = sessionWith(provider);
    await collectTurn(session, 'hi', { systemPrompt: 'BASE PROMPT' });
    expect(provider.received[0]!.system).toBeUndefined();
  });

  it('emits abort event when session is aborted mid-stream', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('slow', {}, 'c1'), textReply('after')],
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'slow',
        description: '',
        inputSchema: z.object({}),
        handler: async () => {
          await new Promise((r) => setTimeout(r, 1000));
          return 'done';
        },
      }),
    );

    setTimeout(() => session.abort('test abort'), 20);
    const events = await collectTurn(session, 'go');
    const aborted = events.find((e) => e.type === 'abort');
    // Either the abort fires before tool execution completes, or the tool_result has kind 'aborted'
    const result = events.find((e) => e.type === 'tool_result');
    if (result?.type === 'tool_result' && !result.ok) {
      expect(result.error?.kind === 'aborted' || result.error?.kind === 'threw').toBe(true);
    } else {
      expect(aborted).toBeDefined();
    }
  });

  it('backs off then recovers when a retryable provider error precedes a clean call', async () => {
    const sleep = vi.fn(async () => {});
    const restore = __setRetrySleepForTests(sleep);
    try {
      const provider = new FakeProvider({
        script: [retryableErrorReply(), textReply('recovered')],
      });
      const session = sessionWith(provider);

      const events = await collectTurn(session, 'hi');
      // The retryable error was surfaced...
      const retryable = events.filter((e) => e.type === 'error' && e.kind === 'retryable');
      expect(retryable).toHaveLength(1);
      // ...the loop waited before retrying (back-off applied, not a busy-loop)...
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep.mock.calls[0]![0]).toBeGreaterThan(0);
      // ...and the next clean call succeeded.
      const last = events[events.length - 1];
      if (last.type !== 'assistant_message') throw new Error('expected assistant_message last');
      expect(last.content).toBe('recovered');
    } finally {
      restore();
    }
  });

  it('emits a clean abort (not a fatal error) when aborted during the provider stream', async () => {
    // Regression: a cancellation WHILE collectProviderStream is consuming the
    // stream surfaces as a non-retryable provider error ("operation was
    // aborted"). The loop must recognize the set abort signal and emit a clean
    // `abort` event, NOT a `kind: 'fatal'` error that renders as a failed turn.
    // Abort synchronously at the start of the provider call so the signal is set
    // by the time collectProviderStream returns the abort-classified error.
    let abort: () => void = () => {};
    const provider = new FakeProvider({
      script: [abortDuringStreamReply()],
      onRequest: () => abort(),
    });
    const session = sessionWith(provider);
    abort = () => session.abort('test abort mid-stream');

    const events = await collectTurn(session, 'hi');
    const aborted = events.find((e) => e.type === 'abort');
    expect(aborted).toBeDefined();
    if (aborted?.type !== 'abort') throw new Error('expected abort');
    expect(aborted.reason).toMatch(/provider stream/);
    // No fatal error event leaked the raw abort message.
    const fatal = events.filter((e) => e.type === 'error' && e.kind === 'fatal');
    expect(fatal).toHaveLength(0);
    // And the raw "operation was aborted" message was never surfaced as an error.
    const rawAbortError = events.filter(
      (e) => e.type === 'error' && /operation was aborted/i.test(e.message),
    );
    expect(rawAbortError).toHaveLength(0);
  });

  it('coerces a degenerate maxIterations (0) to at least one iteration instead of an instant fatal', async () => {
    // Regression: an unvalidated maxIterations of 0 made the loop body never run
    // and emit a misleading "exceeded maxIterations" fatal. A coerced bound runs
    // the turn normally.
    const provider = new FakeProvider({ script: [textReply('hello')] });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi', { maxIterations: 0 });
    // The single iteration ran and produced a normal assistant message.
    const last = events[events.length - 1];
    if (last.type !== 'assistant_message') throw new Error('expected assistant_message last');
    expect(last.content).toBe('hello');
    // No fatal "exceeded maxIterations" fired on the very first turn.
    const fatal = events.filter((e) => e.type === 'error' && e.kind === 'fatal');
    expect(fatal).toHaveLength(0);
  });

  it('surfaces an empty-completion note when a turn truncates to no text and no tools', async () => {
    // Regression: a max_tokens completion truncated to nothing emitted only a
    // blank assistant bubble. Now a retryable note explains why the turn was
    // empty, alongside the (preserved) empty assistant_message.
    const provider = new FakeProvider({ script: [emptyMaxTokensReply()] });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi');
    const note = events.filter(
      (e) => e.type === 'error' && e.kind === 'retryable' && /empty completion/i.test(e.message),
    );
    expect(note).toHaveLength(1);
    // The empty assistant_message is still emitted (existing behavior preserved).
    const assistant = events.filter((e) => e.type === 'assistant_message');
    expect(assistant).toHaveLength(1);
    if (assistant[0]?.type !== 'assistant_message') throw new Error('expected assistant_message');
    expect(assistant[0].content).toBe('');
  });

  it('gives up with a fatal error after the bounded retry count, not maxIterations', async () => {
    const delays: number[] = [];
    const restore = __setRetrySleepForTests(async (ms) => {
      delays.push(ms);
    });
    try {
      // The provider returns a retryable error forever — without a bound this
      // would busy-loop up to maxIterations (500) times.
      const provider = new FakeProvider({
        script: Array.from({ length: 50 }, () => retryableErrorReply()),
      });
      const session = sessionWith(provider);

      const events = await collectTurn(session, 'hi');
      const fatal = events.filter((e) => e.type === 'error' && e.kind === 'fatal');
      expect(fatal).toHaveLength(1);
      if (fatal[0]?.type !== 'error') throw new Error();
      expect(fatal[0].message).toMatch(/giving up/i);
      // It hit the provider exactly MAX_CONSECUTIVE_RETRIES times (one provider
      // call per retry), nowhere near the 500-iteration cap.
      expect(provider.received).toHaveLength(MAX_CONSECUTIVE_RETRIES);
      // Back-off delays increased (exponential), proving real back-off ran on
      // each attempt before the final give-up.
      expect(delays).toHaveLength(MAX_CONSECUTIVE_RETRIES - 1);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
      }
    } finally {
      restore();
    }
  });
});
