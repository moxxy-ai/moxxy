import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineMode,
  definePlugin,
  defineTool,
  runReactLoop,
  type CheckpointContext,
  type CheckpointResult,
  type ModeContext,
  type ProviderEvent,
  type TurnCheckpoint,
} from '@moxxy/sdk';
import { collectTurn, type Session } from '@moxxy/core';
import { FakeProvider, createFakeSession, textReply, toolUseReply } from '@moxxy/testing';

/**
 * End-to-end coverage for the shared ReAct loop's turn-end checkpoint gate,
 * exercised through a real Session + FakeProvider (the same harness the mode
 * suites use) so every assertion runs against the events channels actually
 * observe. The plain no-checkpoint path is covered by the mode-default suite
 * (`index.test.ts`) — this file covers the gate.
 */

const GATED_MODE = 'gated-test';

/** A text completion truncated by max_tokens — NOT a natural end_turn. */
const truncatedTextReply = (text: string): ReadonlyArray<ProviderEvent> => [
  { type: 'message_start', model: 'fake' },
  { type: 'text_delta', delta: text },
  { type: 'message_end', stopReason: 'max_tokens' },
];

/** Build a session whose active mode is runReactLoop + the given checkpoints. */
function gatedSession(
  provider: FakeProvider,
  checkpoints: ReadonlyArray<TurnCheckpoint>,
  opts: { maxInjections?: number; asSubagent?: boolean } = {},
): Session {
  const session = createFakeSession({ provider });
  session.pluginHost.registerStatic(
    definePlugin({
      name: '@moxxy/mode-gated-test',
      version: '0.0.0',
      modes: [
        defineMode({
          name: GATED_MODE,
          description: 'runReactLoop with test checkpoints',
          run: (ctx: ModeContext) =>
            runReactLoop(opts.asSubagent ? { ...ctx, isSubagent: true } : ctx, {
              strategyName: GATED_MODE,
              checkpoints,
              ...(opts.maxInjections !== undefined ? { maxInjections: opts.maxInjections } : {}),
            }),
        }),
      ],
    }),
  );
  session.modes.setActive(GATED_MODE);
  return session;
}

/** The turn's final assistant text (gate lifecycle events may follow it). */
const lastAssistantText = (events: ReadonlyArray<{ type: string }>): string | undefined => {
  const msgs = events.filter(
    (e): e is { type: 'assistant_message'; content: string } => e.type === 'assistant_message',
  );
  return msgs[msgs.length - 1]?.content;
};

const checkpointSubtypes = (events: ReadonlyArray<{ type: string }>): string[] =>
  events
    .filter(
      (e): e is { type: 'plugin_event'; subtype: string } =>
        e.type === 'plugin_event' && String((e as { pluginId?: unknown }).pluginId) === 'react-loop',
    )
    .map((e) => e.subtype);

describe('runReactLoop checkpoint gate', () => {
  it('persistently injects feedback, loops, and passes on the fixed attempt', async () => {
    const provider = new FakeProvider({ script: [textReply('draft answer'), textReply('fixed answer')] });
    let calls = 0;
    const lintGate: TurnCheckpoint = {
      name: 'lint',
      run: async (check) => {
        calls += 1;
        expect(check.stopReason).toBe('end_turn');
        return calls === 1 ? { action: 'inject', text: 'lint failed: unused import' } : { action: 'pass' };
      },
    };
    const session = gatedSession(provider, [lintGate]);

    const events = await collectTurn(session, 'do the thing');

    // The injected feedback is a real, persistent log event with checkpoint provenance…
    const injected = events.filter(
      (e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint',
    );
    expect(injected).toHaveLength(1);
    if (injected[0]?.type !== 'user_prompt') throw new Error('expected user_prompt');
    expect(injected[0].text).toBe('lint failed: unused import');
    expect(injected[0].source).toBe('system');
    expect(injected[0].origin?.name).toBe('lint');

    // …the loop ran a second provider round and the model saw the feedback…
    expect(provider.received).toHaveLength(2);
    const secondCallText = provider.received[1]!.messages
      .flatMap((m) => m.content)
      .map((c) => ('text' in c ? c.text : ''))
      .join('\n');
    expect(secondCallText).toContain('lint failed: unused import');

    // …and the gate's lifecycle is observable.
    expect(checkpointSubtypes(events)).toEqual([
      'checkpoint_started',
      'checkpoint_injected',
      'checkpoint_started',
      'checkpoint_passed',
    ]);
    expect(lastAssistantText(events)).toBe('fixed answer');
  });

  it('volatile injection rides exactly one provider call and never lands in the log', async () => {
    const provider = new FakeProvider({
      script: [textReply('first'), textReply('second'), textReply('third')],
    });
    let calls = 0;
    const nudge: TurnCheckpoint = {
      name: 'nudge',
      run: async () => {
        calls += 1;
        if (calls < 3) return { action: 'inject', text: `keep going (${calls})`, volatile: true };
        return { action: 'pass' };
      },
    };
    const session = gatedSession(provider, [nudge]);

    const events = await collectTurn(session, 'go');

    // Never persisted…
    expect(events.some((e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint')).toBe(false);
    // …but each nudge rode exactly its own next call.
    const callTexts = provider.received.map((req) =>
      req.messages.flatMap((m) => m.content).map((c) => ('text' in c ? c.text : '')).join('\n'),
    );
    expect(callTexts[0]).not.toContain('keep going');
    expect(callTexts[1]).toContain('keep going (1)');
    expect(callTexts[1]).not.toContain('keep going (2)');
    expect(callTexts[2]).toContain('keep going (2)');
    expect(callTexts[2]).not.toContain('keep going (1)');
  });

  it('retry loops again without injecting anything', async () => {
    const provider = new FakeProvider({ script: [textReply('one'), textReply('two')] });
    let calls = 0;
    const retryOnce: TurnCheckpoint = {
      name: 'retry-once',
      gateOn: 'idle',
      run: async () => (++calls === 1 ? { action: 'retry' } : { action: 'pass' }),
    };
    const session = gatedSession(provider, [retryOnce]);

    const events = await collectTurn(session, 'go');

    expect(provider.received).toHaveLength(2);
    expect(events.some((e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint')).toBe(false);
    expect(checkpointSubtypes(events)).toEqual([
      'checkpoint_started',
      'checkpoint_retry',
      'checkpoint_started',
      'checkpoint_passed',
    ]);
  });

  it('stop ends the turn immediately and skips remaining checkpoints', async () => {
    const provider = new FakeProvider({ script: [textReply('answer')] });
    let laterRan = false;
    const stopper: TurnCheckpoint = {
      name: 'stopper',
      run: async () => ({ action: 'stop' }),
    };
    const later: TurnCheckpoint = {
      name: 'later',
      run: async () => {
        laterRan = true;
        return { action: 'pass' };
      },
    };
    const session = gatedSession(provider, [stopper, later]);

    const events = await collectTurn(session, 'go');

    expect(provider.received).toHaveLength(1);
    expect(laterRan).toBe(false);
    expect(checkpointSubtypes(events)).toEqual(['checkpoint_started', 'checkpoint_stopped']);
  });

  it('exhausts the injection budget LOUDLY and ships the answer as-is', async () => {
    const provider = new FakeProvider({
      script: [textReply('v1'), textReply('v2'), textReply('v3')],
    });
    const alwaysRed: TurnCheckpoint = {
      name: 'always-red',
      run: async () => ({ action: 'inject', text: 'still failing' }),
    };
    const session = gatedSession(provider, [alwaysRed], { maxInjections: 2 });

    const events = await collectTurn(session, 'go');

    // Two injections spent, then the third candidate ends the turn with a warning.
    expect(provider.received).toHaveLength(3);
    expect(
      events.filter((e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint'),
    ).toHaveLength(2);
    const warning = events.find(
      (e) => e.type === 'error' && e.message.includes('checkpoint budget exhausted'),
    );
    expect(warning).toBeDefined();
    expect(lastAssistantText(events)).toBe('v3');
  });

  it('the injection budget is per idle-EPISODE: tool work resets it', async () => {
    // Idle → inject → work → idle → inject → work → idle → inject → done.
    // Three injections against maxInjections=2 — but never more than one per
    // episode, so the budget (which exists to stop a no-progress wedge) must
    // NOT trip. Before the reset, a long run died on its 3rd spread-out idle
    // with "checkpoint budget exhausted" even though every nudge had worked.
    const provider = new FakeProvider({
      script: [
        textReply('thinking 1'),
        toolUseReply('work', { step: 1 }, 'w1'),
        textReply('thinking 2'),
        toolUseReply('work', { step: 2 }, 'w2'),
        textReply('thinking 3'),
        textReply('done'),
      ],
    });
    const nudgeUnlessDone: TurnCheckpoint = {
      name: 'nudge-unless-done',
      gateOn: 'idle',
      run: async (check): Promise<CheckpointResult> =>
        check.candidateText === 'done'
          ? { action: 'pass' }
          : { action: 'inject', text: 'keep going' },
    };
    const session = gatedSession(provider, [nudgeUnlessDone], { maxInjections: 2 });
    session.tools.register(
      defineTool({
        name: 'work',
        description: '',
        inputSchema: z.object({ step: z.number() }),
        handler: () => 'ok',
      }),
    );

    const events = await collectTurn(session, 'go');

    // All three injections landed (the tool batches reset the budget)…
    expect(
      events.filter((e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint'),
    ).toHaveLength(3);
    // …the run never hit the budget warning and finished naturally.
    expect(
      events.some((e) => e.type === 'error' && e.message.includes('checkpoint budget exhausted')),
    ).toBe(false);
    expect(lastAssistantText(events)).toBe('done');
  });

  it('a crashing checkpoint fails OPEN with a visible warning', async () => {
    const provider = new FakeProvider({ script: [textReply('answer')] });
    const broken: TurnCheckpoint = {
      name: 'broken',
      run: async () => {
        throw new Error('boom');
      },
    };
    const session = gatedSession(provider, [broken]);

    const events = await collectTurn(session, 'go');

    const warning = events.find(
      (e) =>
        e.type === 'error' &&
        e.kind === 'retryable' &&
        e.message.includes('checkpoint "broken" failed: boom — proceeding unchecked'),
    );
    expect(warning).toBeDefined();
    expect(lastAssistantText(events)).toBe('answer');
  });

  it('a hung checkpoint times out and fails OPEN', async () => {
    const provider = new FakeProvider({ script: [textReply('answer')] });
    const hung: TurnCheckpoint = {
      name: 'hung',
      timeoutMs: 1_000, // the enforced floor — keeps the test fast-ish
      run: (check: CheckpointContext) =>
        new Promise<CheckpointResult>((_resolve, reject) => {
          check.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    };
    const session = gatedSession(provider, [hung]);

    const events = await collectTurn(session, 'go');

    const warning = events.find(
      (e) =>
        e.type === 'error' &&
        e.message.includes('checkpoint "hung" timed out after 1000ms — proceeding unchecked'),
    );
    expect(warning).toBeDefined();
    expect(lastAssistantText(events)).toBe('answer');
  }, 15_000);

  it('empty injected feedback is ignored as a checker bug (fail open)', async () => {
    const provider = new FakeProvider({ script: [textReply('answer')] });
    const blank: TurnCheckpoint = {
      name: 'blank',
      run: async () => ({ action: 'inject', text: '   ' }),
    };
    const session = gatedSession(provider, [blank]);

    const events = await collectTurn(session, 'go');

    expect(provider.received).toHaveLength(1);
    expect(
      events.some(
        (e) => e.type === 'error' && e.message.includes('checkpoint "blank" injected empty feedback'),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint')).toBe(false);
  });

  it('default gateOn skips truncated candidates; gateOn idle sees them', async () => {
    const provider = new FakeProvider({ script: [truncatedTextReply('partial…')] });
    let endTurnRan = false;
    let idleRan = false;
    let idleStopReason: string | undefined;
    const endTurnGate: TurnCheckpoint = {
      name: 'end-turn-only',
      run: async () => {
        endTurnRan = true;
        return { action: 'pass' };
      },
    };
    const idleGate: TurnCheckpoint = {
      name: 'idle-too',
      gateOn: 'idle',
      run: async (check) => {
        idleRan = true;
        idleStopReason = check.stopReason;
        return { action: 'pass' };
      },
    };
    const session = gatedSession(provider, [endTurnGate, idleGate]);

    await collectTurn(session, 'go');

    expect(endTurnRan).toBe(false);
    expect(idleRan).toBe(true);
    expect(idleStopReason).toBe('max_tokens');
  });

  it('consecutiveIdle counts idle rounds and resets after a tool batch', async () => {
    const provider = new FakeProvider({
      script: [
        textReply('idle once'),
        toolUseReply('echo', { msg: 'work' }, 'c1'),
        textReply('idle again'),
      ],
    });
    const seen: number[] = [];
    const recorder: TurnCheckpoint = {
      name: 'recorder',
      gateOn: 'idle',
      run: async (check) => {
        seen.push(check.consecutiveIdle);
        return seen.length === 1 ? { action: 'retry' } : { action: 'pass' };
      },
    };
    const session = gatedSession(provider, [recorder]);
    session.tools.register(
      defineTool({
        name: 'echo',
        description: 'returns msg',
        inputSchema: z.object({ msg: z.string() }),
        handler: (i) => i.msg,
      }),
    );

    await collectTurn(session, 'go');

    // Round 1 idles (consecutiveIdle 1), the retry round does real tool work
    // (counter resets), the final idle round starts over at 1.
    expect(seen).toEqual([1, 1]);
  });

  it('checkpoints are disarmed inside subagent sessions (recursion backstop)', async () => {
    const provider = new FakeProvider({ script: [textReply('child answer')] });
    let ran = false;
    const recorder: TurnCheckpoint = {
      name: 'recorder',
      run: async () => {
        ran = true;
        return { action: 'pass' };
      },
    };
    const session = gatedSession(provider, [recorder], { asSubagent: true });

    const events = await collectTurn(session, 'go');

    expect(ran).toBe(false);
    expect(checkpointSubtypes(events)).toEqual([]);
    const last = events[events.length - 1];
    if (last?.type !== 'assistant_message') throw new Error('expected assistant_message last');
    expect(last.content).toBe('child answer');
  });

  it('oversized feedback is clamped with an explicit truncation marker', async () => {
    const provider = new FakeProvider({ script: [textReply('v1'), textReply('v2')] });
    let calls = 0;
    const chatty: TurnCheckpoint = {
      name: 'chatty',
      run: async () => (++calls === 1 ? { action: 'inject', text: 'x'.repeat(40_000) } : { action: 'pass' }),
    };
    const session = gatedSession(provider, [chatty]);

    const events = await collectTurn(session, 'go');

    const injected = events.find((e) => e.type === 'user_prompt' && e.origin?.kind === 'checkpoint');
    if (injected?.type !== 'user_prompt') throw new Error('expected injected user_prompt');
    expect(injected.text.length).toBeLessThan(17_000);
    expect(injected.text).toContain('[checkpoint feedback truncated');
  });

  it('user abort during a checkpoint ends the turn quietly, keeping the answer', async () => {
    const provider = new FakeProvider({ script: [textReply('answer')] });
    const controller = new AbortController();
    const aborter: TurnCheckpoint = {
      name: 'aborter',
      run: async () => {
        controller.abort();
        throw new Error('interrupted by user cancel');
      },
    };
    const session = gatedSession(provider, [aborter]);

    const events = await collectTurn(session, 'go', { signal: controller.signal });

    // No "proceeding unchecked" noise — the cancel is not a checker failure…
    expect(events.some((e) => e.type === 'error' && e.message.includes('proceeding unchecked'))).toBe(
      false,
    );
    // …and the already-produced answer is not retracted.
    expect(
      events.some((e) => e.type === 'assistant_message' && e.content === 'answer'),
    ).toBe(true);
  });
});
