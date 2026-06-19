import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type ProviderEvent } from '@moxxy/sdk';
import { collectTurn } from '@moxxy/core';
import { FakeProvider, createFakeSession, textReply, toolUseReply } from '@moxxy/testing';

import { goalModePlugin, GOAL_MODE_NAME } from './index.js';
import { __setRetrySleepForTests } from './goal-loop.js';

/** A scripted provider reply that surfaces a retryable error mid-stream. */
function retryableErrorReply(message = 'overloaded'): ProviderEvent[] {
  return [
    { type: 'message_start', model: 'fake' },
    { type: 'error', message, retryable: true },
  ];
}

describe('goalMode end-to-end', () => {
  it('stops with goal_completed when the model calls goal_complete', async () => {
    const provider = new FakeProvider({
      script: [
        toolUseReply('goal_complete', { summary: 'Refactored the parser', evidence: ['tests pass'] }, 'gc1'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'refactor the parser');

    // The run announced it started, then completed (and nothing after).
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_started')).toBe(true);
    const completed = events.find((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed');
    expect(completed).toBeDefined();
    if (completed?.type !== 'plugin_event') throw new Error('expected goal_completed');
    expect((completed.payload as { summary: string }).summary).toBe('Refactored the parser');

    // Final system message surfaces the summary to the user.
    const finalMsg = events
      .filter((e) => e.type === 'assistant_message' && e.source === 'system')
      .pop();
    if (finalMsg?.type !== 'assistant_message') throw new Error('expected final system message');
    expect(finalMsg.content).toContain('Refactored the parser');

    // The goal tool actually ran and was auto-approved (no permission prompt).
    expect(
      events.some((e) => e.type === 'tool_call_approved' && e.mode === 'allow'),
    ).toBe(true);
  });

  it('auto-approves a normal tool call mid-run (full autonomy), then completes', async () => {
    const provider = new FakeProvider({
      script: [
        // First the model does real work via a tool…
        toolUseReply('list_dir', { path: '.' }, 'work1'),
        // …then declares done.
        toolUseReply('goal_complete', { summary: 'listed files' }, 'gc2'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'list the files then finish');
    // The work tool was auto-approved without any ask/permission round-trip.
    const approvals = events.filter((e) => e.type === 'tool_call_approved');
    expect(approvals.length).toBeGreaterThanOrEqual(2); // work tool + goal_complete
    expect(approvals.every((e) => e.type === 'tool_call_approved' && e.mode === 'allow')).toBe(true);
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(true);
  });

  it('honours a user deny rule (policy) while still auto-approving other tools', async () => {
    let dangerousRan = false;
    const provider = new FakeProvider({
      script: [
        // The model tries the denied tool first…
        toolUseReply('dangerous', { target: 'prod' }, 'd1'),
        // …then a permitted one, then declares done.
        toolUseReply('safe', {}, 's1'),
        toolUseReply('goal_complete', { summary: 'finished without the denied tool' }, 'gc3'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);
    session.tools.register(
      defineTool({
        name: 'dangerous',
        description: '',
        inputSchema: z.object({ target: z.string() }),
        handler: () => {
          dangerousRan = true;
          return 'boom';
        },
      }),
    );
    session.tools.register(
      defineTool({ name: 'safe', description: '', inputSchema: z.object({}), handler: () => 'ok' }),
    );
    // Same persistent policy engine that backs ~/.moxxy/permissions.json.
    await session.permissions.addDeny({ name: 'dangerous', reason: 'user denied this tool' });
    // Tripwire: goal mode must never fall through to the interactive prompt
    // path. If it did, dispatchToolCall would surface a pre-execute failure.
    session.setPermissionResolver({
      name: 'tripwire-prompt',
      check: async () => {
        throw new Error('interactive prompt fired in goal mode');
      },
    });

    const events = await collectTurn(session, 'do the thing');

    // The deny rule held, with the user's reason…
    const denied = events.find((e) => e.type === 'tool_call_denied');
    if (denied?.type !== 'tool_call_denied') throw new Error('expected a tool_call_denied event');
    expect(denied.decidedBy).toBe('resolver');
    expect(denied.reason).toContain('user denied this tool');
    // …the denied call still produced a well-formed failed tool_result…
    const deniedResult = events.find(
      (e) => e.type === 'tool_result' && e.callId === denied.callId,
    );
    if (deniedResult?.type !== 'tool_result') throw new Error('expected a tool_result for the denial');
    expect(deniedResult.ok).toBe(false);
    // …and the handler never executed.
    expect(dangerousRan).toBe(false);

    // Everything else still auto-approves without prompting (the tripwire
    // would have failed those calls) and the run completes.
    const approvals = events.filter((e) => e.type === 'tool_call_approved');
    expect(approvals.length).toBeGreaterThanOrEqual(2); // safe + goal_complete
    expect(approvals.every((e) => e.type === 'tool_call_approved' && e.mode === 'allow')).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'tool_result' && !e.ok && e.error.message.includes('pre-execute failure'),
      ),
    ).toBe(false);
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(true);
  });

  it('stalls (goal_stalled) when the model keeps idling without completing', async () => {
    // GOAL_MAX_NOOP_ITERATIONS idle (no-tool) replies → the loop gives up.
    const provider = new FakeProvider({
      script: [
        textReply('Thinking about it...'),
        textReply('Still working through it...'),
        textReply('I believe this is fine.'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'do something vague');

    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stalled')).toBe(true);
    // It did NOT falsely report completion.
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(false);
  });

  it('emits a paired result for every request even when the stuck loop trips', async () => {
    // The model hammers the same (name, input) until the detector trips. The
    // stuck trip ends the turn before executeToolUses runs the final request —
    // without synthesizing a result that request is orphaned (renders as a tool
    // stuck "running" forever, flips to error only on the next user_prompt).
    const provider = new FakeProvider({
      script: Array.from({ length: 20 }, (_, i) => toolUseReply('loop', {}, `c${i}`)),
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);
    session.tools.register(
      defineTool({
        name: 'loop',
        description: '',
        inputSchema: z.object({}),
        handler: () => 'ok',
      }),
    );

    const events = await collectTurn(session, 'spin');
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stuck')).toBe(true);

    const requestedIds = new Set(
      events.filter((e) => e.type === 'tool_call_requested').map((e) => e.callId),
    );
    const resolvedIds = new Set(
      events.filter((e) => e.type === 'tool_result').map((e) => e.callId),
    );
    const orphans = [...requestedIds].filter((id) => !resolvedIds.has(id));
    expect(orphans).toEqual([]);
  });

  // u67-2: the cumulative token-budget backstop must stop the run (the exact
  // unbounded-run failure the guard exists to prevent).
  it('stops with goal_budget_exhausted when cumulative usage exceeds the budget', () => {
    // A single reply whose usage blows past GOAL_TOKEN_BUDGET (4M). The budget
    // check runs right after the provider call, before any tool work, so this
    // trips on iteration 1.
    const hugeUsage: ProviderEvent[] = [
      { type: 'message_start', model: 'fake' },
      { type: 'text_delta', delta: 'working...' },
      {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 5_000_000, outputTokens: 0 },
      },
    ];
    const provider = new FakeProvider({ script: [hugeUsage] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    return collectTurn(session, 'do an expensive thing').then((events) => {
      const exhausted = events.find(
        (e) => e.type === 'plugin_event' && e.subtype === 'goal_budget_exhausted',
      );
      expect(exhausted).toBeDefined();
      if (exhausted?.type !== 'plugin_event') throw new Error('expected goal_budget_exhausted');
      expect((exhausted.payload as { budget: number }).budget).toBe(4_000_000);
      // It did NOT falsely report completion, and a final system message tells
      // the user how to continue.
      expect(
        events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed'),
      ).toBe(false);
      const finalMsg = events
        .filter((e) => e.type === 'assistant_message' && e.source === 'system')
        .pop();
      if (finalMsg?.type !== 'assistant_message') throw new Error('expected final system message');
      expect(finalMsg.content).toContain('token budget exhausted');
    });
  });

  // u67-3: the budget-exhausting call's reasoning must still be persisted to the
  // log before the budget exit, matching every other exit path (otherwise the
  // final call's reasoning is silently dropped).
  it('persists the budget-exhausting call reasoning before goal_budget_exhausted', () => {
    const hugeUsageWithReasoning: ProviderEvent[] = [
      { type: 'message_start', model: 'fake' },
      { type: 'reasoning_delta', delta: 'I should think hard about this expensive task.' },
      { type: 'reasoning_signature', signature: 'sig-1' },
      { type: 'text_delta', delta: 'working...' },
      {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 5_000_000, outputTokens: 0 },
      },
    ];
    const provider = new FakeProvider({ script: [hugeUsageWithReasoning] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    return collectTurn(session, 'do an expensive thing').then((events) => {
      const reasoningIdx = events.findIndex((e) => e.type === 'reasoning_message');
      const exhaustedIdx = events.findIndex(
        (e) => e.type === 'plugin_event' && e.subtype === 'goal_budget_exhausted',
      );
      expect(reasoningIdx).toBeGreaterThanOrEqual(0);
      expect(exhaustedIdx).toBeGreaterThanOrEqual(0);
      // The reasoning_message lands BEFORE the budget exit (the bug dropped it).
      expect(reasoningIdx).toBeLessThan(exhaustedIdx);
      const reasoning = events[reasoningIdx];
      if (reasoning?.type !== 'reasoning_message') throw new Error('expected reasoning_message');
      expect(reasoning.content).toContain('think hard');
      expect(reasoning.signature).toBe('sig-1');
    });
  });

  // u67-2: the hard iteration cap must end the run with goal_max_iterations + a
  // fatal error when the model never calls goal_complete.
  it('stops with goal_max_iterations when the cap is reached without completing', async () => {
    // The model keeps doing distinct work (varied inputs dodge the stuck-loop
    // detector) and never declares done. ctx.maxIterations=2 bounds the run.
    const provider = new FakeProvider({
      script: [
        toolUseReply('work', { step: 1 }, 'w1'),
        toolUseReply('work', { step: 2 }, 'w2'),
        toolUseReply('work', { step: 3 }, 'w3'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);
    session.tools.register(
      defineTool({
        name: 'work',
        description: '',
        inputSchema: z.object({ step: z.number() }),
        handler: () => 'ok',
      }),
    );

    const events = await collectTurn(session, 'keep working forever', { maxIterations: 2 });

    const cap = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'goal_max_iterations',
    );
    expect(cap).toBeDefined();
    if (cap?.type !== 'plugin_event') throw new Error('expected goal_max_iterations');
    expect((cap.payload as { maxIterations: number }).maxIterations).toBe(2);
    // A fatal error closes the run; it did not falsely complete.
    expect(
      events.some((e) => e.type === 'error' && e.kind === 'fatal' && e.message.includes('iteration cap')),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed'),
    ).toBe(false);
  });

  describe('retryable provider errors (busy-loop guard)', () => {
    // Make the back-off instant + deterministic so the bounded-retry path runs
    // without real timers. Restore after every test (the seam is a module
    // singleton shared process-wide).
    let restore: (() => void) | undefined;
    afterEach(() => {
      restore?.();
      restore = undefined;
    });

    it('bails with a fatal error after MAX_CONSECUTIVE_RETRIES instead of busy-looping the provider', async () => {
      let sleeps = 0;
      restore = __setRetrySleepForTests(async () => {
        sleeps += 1;
      });
      // The provider is stuck returning retryable errors forever. Without the
      // cap this would re-hit the provider up to maxIterations (150) times with
      // zero spacing — exactly the unattended busy-loop the guard prevents.
      const provider = new FakeProvider({
        script: Array.from({ length: 50 }, () => retryableErrorReply('rate limited')),
      });
      const session = createFakeSession({ provider });
      session.pluginHost.registerStatic(goalModePlugin);
      session.modes.setActive(GOAL_MODE_NAME);

      const events = await collectTurn(session, 'do the thing');

      // It gave up with a fatal error mentioning the repeated retryable failure…
      const fatal = events.find(
        (e) => e.type === 'error' && e.kind === 'fatal' && e.message.includes('retryable error'),
      );
      expect(fatal).toBeDefined();
      // …and it did NOT consume the whole 150-iteration cap — only the bounded
      // retry budget of provider calls happened (6), so 6 errors were surfaced
      // and the loop stopped well before maxIterations.
      const retryableErrors = events.filter(
        (e) => e.type === 'error' && e.kind === 'retryable',
      );
      expect(retryableErrors.length).toBe(6);
      // Every retry but the last backed off (abort-aware sleep), so the provider
      // was never hammered back-to-back.
      expect(sleeps).toBe(5);
      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(
        false,
      );
    });

    it('resets the retry counter after a clean call, recovering from a transient blip', async () => {
      let sleeps = 0;
      restore = __setRetrySleepForTests(async () => {
        sleeps += 1;
      });
      // A few retryable blips, then the provider recovers and the model finishes.
      const provider = new FakeProvider({
        script: [
          retryableErrorReply(),
          retryableErrorReply(),
          toolUseReply('goal_complete', { summary: 'recovered after a blip' }, 'gc-r'),
        ],
      });
      const session = createFakeSession({ provider });
      session.pluginHost.registerStatic(goalModePlugin);
      session.modes.setActive(GOAL_MODE_NAME);

      const events = await collectTurn(session, 'finish despite blips');

      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(
        true,
      );
      // It backed off on each of the two blips (2 sleeps) and never bailed fatal.
      expect(sleeps).toBe(2);
      expect(
        events.some(
          (e) => e.type === 'error' && e.kind === 'fatal' && e.message.includes('retryable'),
        ),
      ).toBe(false);
    });

    it('aborts cleanly mid back-off when the signal fires', async () => {
      const ctrl = new AbortController();
      // The fake sleep aborts the turn the moment the back-off begins, then
      // resolves — mirroring a user cancellation while a retry was pending.
      restore = __setRetrySleepForTests(async (_ms, signal) => {
        ctrl.abort();
        expect(signal.aborted).toBe(true);
      });
      const provider = new FakeProvider({
        script: [retryableErrorReply(), toolUseReply('goal_complete', { summary: 'x' }, 'gc-a')],
      });
      const session = createFakeSession({ provider });
      session.pluginHost.registerStatic(goalModePlugin);
      session.modes.setActive(GOAL_MODE_NAME);

      const events = await collectTurn(session, 'cancel me', { signal: ctrl.signal });

      // The run stopped at an abort (not a fatal) and never completed.
      expect(events.some((e) => e.type === 'abort' && e.reason.includes('back-off'))).toBe(true);
      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(
        false,
      );
    });

    it('treats an un-compactable context overflow marked retryable as fatal (no re-send loop)', async () => {
      let sleeps = 0;
      restore = __setRetrySleepForTests(async () => {
        sleeps += 1;
      });
      // A context-overflow error the provider marked retryable. There is nothing
      // older to compact (the fresh session's tail is the overflow), so a retry
      // would just re-send the identical over-budget prompt forever. The guard
      // must bail fatal instead of looping.
      const provider = new FakeProvider({
        script: Array.from({ length: 10 }, () => [
          { type: 'message_start', model: 'fake' },
          {
            type: 'error',
            message: 'prompt is too long: 250000 tokens > 200000 maximum context length',
            retryable: true,
          },
        ] as ProviderEvent[]),
      });
      const session = createFakeSession({ provider });
      session.pluginHost.registerStatic(goalModePlugin);
      session.modes.setActive(GOAL_MODE_NAME);

      const events = await collectTurn(session, 'overflow');

      // It ended fatal without ever entering the retry back-off path.
      expect(events.some((e) => e.type === 'error' && e.kind === 'fatal')).toBe(true);
      expect(sleeps).toBe(0);
      // The provider was hit at most twice (initial + one reactive-compaction
      // retry that found nothing to compact), never the 10-deep script.
      expect(provider.received.length).toBeLessThanOrEqual(2);
    });
  });

  it('persists the budget-exhausting call assistant text before stopping', () => {
    // The model produces real text on the call that blows the budget. That text
    // must land in the log (source: 'model') so a resume keeps the context —
    // it was silently dropped before the fix.
    const hugeUsageWithText: ProviderEvent[] = [
      { type: 'message_start', model: 'fake' },
      { type: 'text_delta', delta: 'Here is my final analysis before stopping.' },
      {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 5_000_000, outputTokens: 0 },
      },
    ];
    const provider = new FakeProvider({ script: [hugeUsageWithText] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    return collectTurn(session, 'expensive').then((events) => {
      // The model's own text was persisted…
      const modelMsg = events.find(
        (e) => e.type === 'assistant_message' && e.source === 'model',
      );
      if (modelMsg?.type !== 'assistant_message') throw new Error('expected a model assistant_message');
      expect(modelMsg.content).toContain('final analysis');
      // …before the budget plugin_event (matching the reasoning ordering rule).
      const modelIdx = events.indexOf(modelMsg);
      const exhaustedIdx = events.findIndex(
        (e) => e.type === 'plugin_event' && e.subtype === 'goal_budget_exhausted',
      );
      expect(exhaustedIdx).toBeGreaterThanOrEqual(0);
      expect(modelIdx).toBeLessThan(exhaustedIdx);
    });
  });

  it('counts cached prompt tokens toward the budget so the runaway guard trips', () => {
    // Most of the prompt is served from cache (cacheRead) with a tiny live
    // input. Counting input+output alone would leave totalTokens far under the
    // 4M budget; including the cache fields trips it on iteration 1.
    const cachedHeavyUsage: ProviderEvent[] = [
      { type: 'message_start', model: 'fake' },
      { type: 'text_delta', delta: 'working...' },
      {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 100,
          cacheReadTokens: 5_000_000,
          cacheCreationTokens: 0,
        },
      },
    ];
    const provider = new FakeProvider({ script: [cachedHeavyUsage] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    return collectTurn(session, 'cached and expensive').then((events) => {
      const exhausted = events.find(
        (e) => e.type === 'plugin_event' && e.subtype === 'goal_budget_exhausted',
      );
      expect(exhausted).toBeDefined();
      if (exhausted?.type !== 'plugin_event') throw new Error('expected goal_budget_exhausted');
      // totalTokens reflects the FULL prompt (input + cacheRead + output).
      expect((exhausted.payload as { totalTokens: number }).totalTokens).toBe(5_000_200);
    });
  });
});
