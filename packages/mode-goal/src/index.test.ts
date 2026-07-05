import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineMode, definePlugin, defineTool, type ProviderEvent } from '@moxxy/sdk';
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

  it('a stuck-loop trip steers the run instead of killing it (no guardrail abort)', async () => {
    // The model hammers the same (name, input) well past the detector's
    // threshold, then recovers and completes. Goal mode must surface the
    // repetition (goal_stuck + a visible NON-fatal warning + a volatile nudge
    // on the next call) but NEVER abort — the trip used to end the run with a
    // fatal error mid-delivery.
    const provider = new FakeProvider({
      script: [
        ...Array.from({ length: 12 }, (_, i) => toolUseReply('loop', {}, `c${i}`)),
        toolUseReply('goal_complete', { summary: 'recovered and finished' }, 'gc-stuck'),
      ],
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

    // The repetition was noticed and surfaced…
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stuck')).toBe(true);
    const warn = events.find(
      (e) => e.type === 'error' && e.kind === 'retryable' && e.message.includes('repetitive'),
    );
    expect(warn).toBeDefined();
    // …but nothing fatal happened and the run completed.
    expect(events.some((e) => e.type === 'error' && e.kind === 'fatal')).toBe(false);
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(
      true,
    );
    // Every request got a real result (the batch executed — nothing synthesized
    // as aborted, no orphans).
    const requestedIds = new Set(
      events.filter((e) => e.type === 'tool_call_requested').map((e) => e.callId),
    );
    const resolvedIds = new Set(
      events.filter((e) => e.type === 'tool_result').map((e) => e.callId),
    );
    expect([...requestedIds].filter((id) => !resolvedIds.has(id))).toEqual([]);
    // The nudge rode the next provider call as a volatile trailing message.
    const nudged = provider.received.some((req) =>
      req.messages
        .flatMap((m) => m.content)
        .some((c) => 'text' in c && c.text.includes('Repeating the same call will not produce')),
    );
    expect(nudged).toBe(true);
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

  // A degenerate caller-supplied bound (0 / negative / NaN / fractional) bypasses
  // the config schema (programmatic callers: subagents/workflows forward it raw).
  // Without the clamp the for-loop never runs and control falls straight to the
  // misleading "iteration cap reached (0)" fatal — work was never done, yet the
  // message blames the model. The clamp must run at least one real iteration.
  describe('degenerate maxIterations is clamped, not fatal-with-zero-work', () => {
    for (const bad of [0, -5, Number.NaN, 1.9]) {
      it(`runs ≥1 iteration and completes when maxIterations=${String(bad)}`, async () => {
        const provider = new FakeProvider({
          script: [toolUseReply('goal_complete', { summary: 'did one step' }, 'gc-clamp')],
        });
        const session = createFakeSession({ provider });
        session.pluginHost.registerStatic(goalModePlugin);
        session.modes.setActive(GOAL_MODE_NAME);

        const events = await collectTurn(session, 'do it', { maxIterations: bad });

        // It actually drove the model (real work happened) and completed —
        // it did NOT fall through to the zero-work iteration-cap fatal.
        expect(
          events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed'),
        ).toBe(true);
        expect(
          events.some(
            (e) => e.type === 'error' && e.kind === 'fatal' && e.message.includes('iteration cap'),
          ),
        ).toBe(false);
        // The provider was actually called (the loop body ran at least once).
        expect(provider.received.length).toBeGreaterThanOrEqual(1);
      });
    }

    it('reports the clamped cap (not the raw degenerate value) when it later runs out', async () => {
      // maxIterations=0 clamps to 1; the model never completes, so the run hits
      // the cap after a single iteration and the surfaced cap is the clamped 1.
      const provider = new FakeProvider({
        script: Array.from({ length: 3 }, (_, i) => toolUseReply('work', { step: i }, `c${i}`)),
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

      const events = await collectTurn(session, 'never finish', { maxIterations: 0 });

      const cap = events.find(
        (e) => e.type === 'plugin_event' && e.subtype === 'goal_max_iterations',
      );
      if (cap?.type !== 'plugin_event') throw new Error('expected goal_max_iterations');
      // The reported cap is the clamped 1, never the misleading 0.
      expect((cap.payload as { maxIterations: number }).maxIterations).toBe(1);
      // …and one real iteration's worth of work actually ran first.
      expect(provider.received.length).toBe(1);
    });
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
      // bounded retry budget this would re-hit the provider endlessly with
      // zero spacing — exactly the unattended busy-loop the guard prevents.
      // (This is a PROVIDER-protection bound, not a goal guardrail: it fires
      // only on consecutive provider failures, never on productive work.)
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

  describe('no guardrails: nothing heuristic kills a goal run', () => {
    it('runs past the old 150-iteration cap and still completes (uncapped by default)', async () => {
      // 155 productive iterations (varied inputs dodge the stuck detector),
      // then done. Under the old GOAL_MAX_ITERATIONS=150 cap this died with a
      // fatal "iteration cap" error five rounds short of delivering.
      const rounds = 155;
      const provider = new FakeProvider({
        script: [
          ...Array.from({ length: rounds }, (_, i) => toolUseReply('work', { step: i }, `w${i}`)),
          toolUseReply('goal_complete', { summary: 'went the distance' }, 'gc-long'),
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

      const events = await collectTurn(session, 'a very long goal');

      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(
        true,
      );
      expect(
        events.some((e) => e.type === 'error' && e.kind === 'fatal'),
      ).toBe(false);
      expect(provider.received.length).toBe(rounds + 1);
    });

    it('spread-out idle rounds never exhaust the checkpoint budget mid-run', async () => {
      // Idle → nudged back to work → idle → nudged → … four idle EPISODES
      // (more than maxInjections=3), each recovered by tool work, then done.
      // Before the per-episode budget reset this run died on the 4th idle with
      // "checkpoint budget exhausted".
      const script: Array<ReadonlyArray<ProviderEvent>> = [];
      for (let i = 0; i < 4; i++) {
        script.push(textReply(`progress note ${i}`));
        script.push(toolUseReply('work', { step: i }, `iw${i}`));
      }
      script.push(toolUseReply('goal_complete', { summary: 'finished after pauses' }, 'gc-idle'));
      const provider = new FakeProvider({ script });
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

      const events = await collectTurn(session, 'goal with thinking pauses');

      expect(
        events.some((e) => e.type === 'error' && e.message.includes('checkpoint budget exhausted')),
      ).toBe(false);
      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stalled')).toBe(
        false,
      );
      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(
        true,
      );
    });
  });

  describe('one-shot semantics: goal mode disarms itself when the goal concludes', () => {
    /** A no-op mode to stand in for whatever the user was in before /goal. */
    const priorModePlugin = definePlugin({
      name: '@moxxy/testing/prior-mode',
      modes: [
        defineMode({
          name: 'prior',
          run: async function* () {
            /* never driven in these tests */
          },
        }),
      ],
    });

    function armedSession(provider: FakeProvider) {
      const session = createFakeSession({ provider });
      // Register the prior mode FIRST (auto-activates), then arm goal — the
      // registry records 'prior' as the previous mode, like a real /goal.
      session.pluginHost.registerStatic(priorModePlugin);
      session.pluginHost.registerStatic(goalModePlugin);
      session.modes.setActive(GOAL_MODE_NAME);
      return session;
    }

    it('reverts to the previous mode after goal_complete', async () => {
      const provider = new FakeProvider({
        script: [toolUseReply('goal_complete', { summary: 'done' }, 'gc-rev')],
      });
      const session = armedSession(provider);

      await collectTurn(session, 'do it');

      expect(session.modes.getActiveName()).toBe('prior');
    });

    it('reverts to the previous mode after an idle stall (soft completion)', async () => {
      const provider = new FakeProvider({
        script: [textReply('a'), textReply('b'), textReply('c')],
      });
      const session = armedSession(provider);

      const events = await collectTurn(session, 'vague thing');

      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stalled')).toBe(
        true,
      );
      expect(session.modes.getActiveName()).toBe('prior');
    });

    it('stays armed after goal_abandon so the user reply resumes the run', async () => {
      const provider = new FakeProvider({
        script: [
          toolUseReply('goal_abandon', { reason: 'need the API key', needsFromUser: 'the key' }, 'ga-1'),
        ],
      });
      const session = armedSession(provider);

      const events = await collectTurn(session, 'deploy it');

      expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_abandoned')).toBe(
        true,
      );
      expect(session.modes.getActiveName()).toBe(GOAL_MODE_NAME);
    });

    it('stays armed after a user abort (the goal is unfinished)', async () => {
      const ctrl = new AbortController();
      const provider = new FakeProvider({
        script: [toolUseReply('work', { step: 1 }, 'wa-1')],
      });
      const session = armedSession(provider);
      session.tools.register(
        defineTool({
          name: 'work',
          description: '',
          inputSchema: z.object({ step: z.number() }),
          handler: () => {
            ctrl.abort();
            return 'ok';
          },
        }),
      );

      await collectTurn(session, 'interrupt me', { signal: ctrl.signal });

      expect(session.modes.getActiveName()).toBe(GOAL_MODE_NAME);
    });
  });
});
