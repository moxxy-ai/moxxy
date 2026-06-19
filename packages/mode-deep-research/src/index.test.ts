import { describe, expect, it } from 'vitest';
import { collectTurn } from '@moxxy/core';
import { FakeProvider, createFakeSession, textReply } from '@moxxy/testing';
import type {
  LLMProvider,
  ModeContext,
  ProviderEvent,
  ProviderRequest,
  SubagentResult,
  SubagentSpawner,
} from '@moxxy/sdk';
import { asSessionId } from '@moxxy/sdk';

import {
  buildFanoutDigest,
  buildSynthesisInput,
  deepResearchModePlugin,
  RESEARCH_MODE_NAME,
  parseFollowups,
  parseQueries,
  type RoundFinding,
} from './index.js';
import { runFanout } from './fanout-phase.js';
import { SUBAGENT_PRIOR_FINDING_MAX_CHARS } from './constants.js';

describe('parseQueries', () => {
  it('extracts numbered queries after the QUERIES: header', () => {
    expect(
      parseQueries(
        'QUERIES:\n1. What is foo?\n2. How does bar work?\n3. Where is baz used?',
      ),
    ).toEqual(['What is foo?', 'How does bar work?', 'Where is baz used?']);
  });

  it('accepts dashes/bullets', () => {
    expect(parseQueries('QUERIES:\n- alpha\n* beta')).toEqual(['alpha', 'beta']);
  });

  it('returns empty when nothing matches', () => {
    expect(parseQueries('No queries here.')).toEqual([]);
  });

  it('drops wrapped continuation lines (queries are single-line by spec)', () => {
    // A non-list line after an item is NOT joined onto the prior item — it is
    // silently dropped. Pin this so the behavior is encoded, not just commented.
    expect(
      parseQueries('QUERIES:\n1. first part of a long query\nthat wrapped onto a new line\n2. second query'),
    ).toEqual(['first part of a long query', 'second query']);
  });
});

describe('parseFollowups', () => {
  it('parses a numbered FOLLOWUPS block', () => {
    expect(parseFollowups('FOLLOWUPS:\n1. dig deeper on A\n2. verify B')).toEqual([
      'dig deeper on A',
      'verify B',
    ]);
  });

  it('returns empty when the model emits FOLLOWUPS: (none)', () => {
    expect(parseFollowups('FOLLOWUPS: (none)')).toEqual([]);
  });

  it('returns empty when format is missing', () => {
    expect(parseFollowups('I am done, no follow-ups.')).toEqual([]);
  });

  it('does not let a parenthetical near the header swallow a real list', () => {
    // Regression: the "(none)" sentinel must be anchored to a full line so a
    // header-adjacent parenthetical does not discard genuine follow-ups.
    expect(
      parseFollowups(
        'FOLLOWUPS:\n(none of the prior sources covered cost)\n1. find cost data\n2. verify pricing',
      ),
    ).toEqual(['find cost data', 'verify pricing']);
  });

  it('still honors a bare FOLLOWUPS: (none) line', () => {
    expect(parseFollowups('FOLLOWUPS:\n(none)')).toEqual([]);
  });
});

describe('buildFanoutDigest', () => {
  it('marks errored subagents and round numbers explicitly', () => {
    const findings: RoundFinding[] = [
      { round: 1, question: 'Q1', text: 'first headline that should appear' },
      { round: 1, question: 'Q2', text: '', error: 'timed out' },
      { round: 2, question: 'Q3 follow-up', text: 'second-round detail' },
    ];
    const out = buildFanoutDigest(findings);
    expect(out).toContain('2 of 3 subagents returned');
    expect(out).toContain('1 errored');
    expect(out).toContain('errored: timed out');
    expect(out).toContain('first headline');
    expect(out).toContain('[round 1]');
    expect(out).toContain('[round 2]');
  });
});

describe('buildSynthesisInput', () => {
  it('weaves original prompt with per-round findings', () => {
    const findings: RoundFinding[] = [
      { round: 1, question: 'sub-q one', text: 'finding one' },
      { round: 2, question: 'follow-up two', text: 'finding two' },
    ];
    const body = buildSynthesisInput('What is the question?', findings);
    expect(body).toContain('Original question:');
    expect(body).toContain('What is the question?');
    expect(body).toContain('(round 1): sub-q one');
    expect(body).toContain('finding one');
    expect(body).toContain('(round 2): follow-up two');
    expect(body).toContain('finding two');
  });
});

describe('runFanout (resilience + bounded prompts)', () => {
  function ctxWithSpawner(spawnAll: SubagentSpawner['spawnAll']): ModeContext {
    const subagents: SubagentSpawner = {
      async spawn() {
        return fakeResult('unused');
      },
      spawnAll,
    };
    return { subagents } as unknown as ModeContext;
  }

  it('isolates a spawnAll rejection into per-query error entries instead of crashing', async () => {
    // Worst case: a single child's setup work throws and rejects the whole
    // Promise.all batch. runFanout must NOT propagate — it returns synthetic
    // error entries so the loop can still carry findings into synthesis.
    const ctx = ctxWithSpawner(async () => {
      throw new Error('child setup blew up');
    });

    const outcome = await runFanout(ctx, ['q1', 'q2', 'q3']);
    expect(outcome.results).toEqual([]);
    expect(outcome.errored).toEqual([
      { index: 0, message: 'child setup blew up' },
      { index: 1, message: 'child setup blew up' },
      { index: 2, message: 'child setup blew up' },
    ]);
  });

  it('bounds each prior finding embedded into follow-up subagent prompts', async () => {
    const captured: string[] = [];
    const ctx = ctxWithSpawner(async (specs) => {
      for (const s of specs) captured.push(s.prompt);
      return specs.map(() => fakeResult('ok'));
    });

    const huge = 'x'.repeat(SUBAGENT_PRIOR_FINDING_MAX_CHARS * 4);
    const prior: RoundFinding[] = [{ round: 1, question: 'Q1', text: huge }];

    await runFanout(ctx, ['follow-up query'], prior);

    expect(captured).toHaveLength(1);
    const prompt = captured[0]!;
    expect(prompt).toContain('[truncated]');
    // The full 4x-cap blob must not have been embedded verbatim.
    expect(prompt).not.toContain(huge);
    expect(prompt.length).toBeLessThan(huge.length);
  });
});

describe('deepResearchMode end-to-end (headless)', () => {
  it('emits a fatal error when ctx.subagents is unavailable', async () => {
    const provider = new FakeProvider({ script: [textReply('does not matter')] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    session.modes.replace({
      name: realMode.name,
      run: (ctx) => realMode.run({ ...ctx, subagents: undefined }),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'investigate something');
    const fatal = events.find((e) => e.type === 'error' && e.kind === 'fatal');
    expect(fatal).toBeDefined();
    if (fatal?.type !== 'error') throw new Error();
    expect(fatal.message).toMatch(/subagents/i);
  });

  it('survives a throwing spawnAll and still reaches synthesis instead of crashing', async () => {
    // Worst case: the round-1 fan-out rejects entirely. The turn must not crash;
    // it must record every query as errored and still synthesize.
    const provider = new FakeProvider({
      script: [
        textReply('QUERIES:\n1. First angle?\n2. Second angle?'),
        textReply('FOLLOWUPS: (none)'),
        textReply(
          '## Executive summary\n- bullet\n\n## Key findings\nfinding\n\n## Sources\n(none)\n\n## Open questions\n- none',
        ),
      ],
    });

    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    const throwingSpawner: SubagentSpawner = {
      async spawn() {
        return fakeResult('unused');
      },
      async spawnAll() {
        throw new Error('child setup blew up');
      },
    };
    session.modes.replace({
      name: realMode.name,
      run: (ctx) => realMode.run({ ...ctx, subagents: throwingSpawner }),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'investigate but fan-out fails');

    // No fatal error escaped the loop, and the round still "completed" with all errored.
    const fatal = events.find((e) => e.type === 'error' && e.kind === 'fatal');
    expect(fatal).toBeUndefined();
    const round1Done = events.find(
      (e) =>
        e.type === 'plugin_event' &&
        e.subtype === 'deep_research_fanout_completed' &&
        (e.payload as { round: number }).round === 1,
    );
    expect(round1Done).toBeDefined();
    if (round1Done?.type !== 'plugin_event') throw new Error();
    expect((round1Done.payload as { errored: number }).errored).toBe(2);
    const synthDone = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_synthesis_completed',
    );
    expect(synthDone).toBeDefined();
  });

  it('redrafts an oversized query plan when an approval resolver is present', async () => {
    // Worst case: planner over-produces. With an approval gate + redraft budget,
    // the loop must auto-redraft (narrow-scope feedback) rather than fatally abort.
    const provider = new FakeProvider({
      script: [
        // First plan: 7 queries — over MAX_SUBAGENTS (6).
        textReply(
          'QUERIES:\n1. a?\n2. b?\n3. c?\n4. d?\n5. e?\n6. f?\n7. g?',
        ),
        // Redraft: a sane 2-query plan.
        textReply('QUERIES:\n1. First angle?\n2. Second angle?'),
        textReply('FOLLOWUPS: (none)'),
        textReply(
          '## Executive summary\n- bullet\n\n## Key findings\nfinding\n\n## Sources\n(none)\n\n## Open questions\n- none',
        ),
      ],
    });

    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    const approval = { name: 'fake', confirm: async () => ({ optionId: 'approve' }) };
    const okSpawner: SubagentSpawner = {
      async spawn() {
        return fakeResult('unused');
      },
      async spawnAll(specs) {
        return specs.map((_, i) =>
          fakeResult(`FINDINGS: angle ${i + 1}.\n\nSOURCES:\n[1] X — http://x`),
        );
      },
    };
    session.modes.replace({
      name: realMode.name,
      run: (ctx) =>
        realMode.run({ ...ctx, subagents: okSpawner, approval } as typeof ctx),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'be exhaustive about something');

    // The oversized plan must NOT have produced a fatal abort.
    const fatal = events.find((e) => e.type === 'error' && e.kind === 'fatal');
    expect(fatal).toBeUndefined();
    // A second drafted-queries event proves the redraft happened.
    const drafts = events.filter(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_queries_drafted',
    );
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    const synthDone = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_synthesis_completed',
    );
    expect(synthDone).toBeDefined();
  });

  it('emits a fatal error when the log has no user prompt to anchor on', async () => {
    const provider = new FakeProvider({ script: [textReply('QUERIES:\n1. x?')] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    const okSpawner: SubagentSpawner = {
      async spawn() {
        return fakeResult('unused');
      },
      async spawnAll(specs) {
        return specs.map(() => fakeResult('FINDINGS: x'));
      },
    };
    // Override ctx.log to report no user_prompt events — the empty-log worst case.
    session.modes.replace({
      name: realMode.name,
      run: (ctx) =>
        realMode.run({
          ...ctx,
          subagents: okSpawner,
          log: { ...ctx.log, slice: () => [] },
        } as typeof ctx),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'this prompt is ignored by the patched log');
    const fatal = events.find((e) => e.type === 'error' && e.kind === 'fatal');
    expect(fatal).toBeDefined();
    if (fatal?.type !== 'error') throw new Error();
    expect(fatal.message).toMatch(/no user prompt/i);
  });

  it('runs gather → followup-plan(none) → synthesis when model says no follow-ups', async () => {
    const provider = new FakeProvider({
      script: [
        textReply('QUERIES:\n1. First angle?\n2. Second angle?'),
        textReply('FOLLOWUPS: (none)'),
        textReply(
          '## Executive summary\n- bullet\n\n## Key findings\nfinding [1]\n\n## Sources\n[1] x — http://x\n\n## Open questions\n- none',
        ),
      ],
    });

    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    const fakeSpawner: SubagentSpawner = {
      async spawn() {
        return fakeResult('single-spawn unused in this test');
      },
      async spawnAll(specs) {
        return specs.map((_, i) =>
          fakeResult(`FINDINGS: angle ${i + 1} answered.\n\nSOURCES:\n[1] X — http://x`),
        );
      },
    };
    session.modes.replace({
      name: realMode.name,
      run: (ctx) => realMode.run({ ...ctx, subagents: fakeSpawner }),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'investigate something else');

    const queriesDrafted = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_queries_drafted',
    );
    expect(queriesDrafted).toBeDefined();

    const round1Completed = events.find(
      (e) =>
        e.type === 'plugin_event' &&
        e.subtype === 'deep_research_fanout_completed' &&
        (e.payload as { round: number }).round === 1,
    );
    expect(round1Completed).toBeDefined();

    const followupsNone = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_followups_none',
    );
    expect(followupsNone).toBeDefined();

    const synthDone = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_synthesis_completed',
    );
    expect(synthDone).toBeDefined();
  });

  it('emits an abort (not the report) when the signal fires during synthesis', async () => {
    // u65-4: every other phase guards ctx.signal.aborted; synthesis must too —
    // a cancel during the multi-second synthesis call should yield an abort, not
    // a finished assistant_message.
    const fake = new FakeProvider({
      script: [
        textReply('QUERIES:\n1. First angle?\n2. Second angle?'),
        textReply('FOLLOWUPS: (none)'),
        textReply(
          '## Executive summary\n- bullet\n\n## Key findings\nfinding [1]\n\n## Sources\n[1] x — http://x\n\n## Open questions\n- none',
        ),
      ],
    });
    const controller = new AbortController();
    const provider = abortOnSynthesisProvider(fake, controller);

    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const fakeSpawner: SubagentSpawner = {
      async spawn() {
        return fakeResult('unused');
      },
      async spawnAll(specs) {
        return specs.map((_, i) =>
          fakeResult(`FINDINGS: angle ${i + 1} answered.\n\nSOURCES:\n[1] X — http://x`),
        );
      },
    };
    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    session.modes.replace({
      name: realMode.name,
      run: (ctx) =>
        realMode.run({ ...ctx, subagents: fakeSpawner, signal: controller.signal }),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'investigate then cancel');

    const abort = events.find((e) => e.type === 'abort');
    expect(abort).toBeDefined();
    if (abort?.type === 'abort') expect(abort.reason).toMatch(/synthesis/);

    // The finished report must NOT have been emitted as an assistant_message,
    // nor the synthesis-completed plugin event.
    const reportEmitted = events.some(
      (e) => e.type === 'assistant_message' && e.content.includes('Executive summary'),
    );
    expect(reportEmitted).toBe(false);
    const synthDone = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_synthesis_completed',
    );
    expect(synthDone).toBeUndefined();
  });

  it('runs gather → followup-plan(2 queries) → round-2 fanout → synthesis', async () => {
    const provider = new FakeProvider({
      script: [
        // Round-1 query plan
        textReply('QUERIES:\n1. First angle?\n2. Second angle?'),
        // Follow-up plan after round 1 — model asks for 2 follow-ups
        textReply('FOLLOWUPS:\n1. verify claim X\n2. cross-check source Y'),
        // Follow-up plan after round 2 — model says we're done
        textReply('FOLLOWUPS: (none)'),
        // Synthesis
        textReply(
          '## Executive summary\n- bullet\n\n## Key findings\nfinding [1]\n\n## Sources\n[1] x — http://x\n\n## Open questions\n- none',
        ),
      ],
    });

    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(deepResearchModePlugin);
    session.modes.setActive(RESEARCH_MODE_NAME);

    const calls: number[] = [];
    const fakeSpawner: SubagentSpawner = {
      async spawn() {
        return fakeResult('single-spawn unused');
      },
      async spawnAll(specs) {
        calls.push(specs.length);
        return specs.map((s, i) =>
          fakeResult(
            `FINDINGS: ${s.label ?? 'sub'} #${i + 1} answered.\n\nSOURCES:\n[1] X — http://x`,
          ),
        );
      },
    };
    const realMode = session.modes.list().find((m) => m.name === RESEARCH_MODE_NAME)!;
    session.modes.replace({
      name: realMode.name,
      run: (ctx) => realMode.run({ ...ctx, subagents: fakeSpawner }),
    });
    session.modes.setActive(realMode.name);

    const events = await collectTurn(session, 'investigate iran-usa coverage');

    // Two rounds of fan-out happened (2 round-1 + 2 round-2 = 4 subagent calls).
    expect(calls).toEqual([2, 2]);

    const round2Completed = events.find(
      (e) =>
        e.type === 'plugin_event' &&
        e.subtype === 'deep_research_fanout_completed' &&
        (e.payload as { round: number }).round === 2,
    );
    expect(round2Completed).toBeDefined();

    const followupsDrafted = events.filter(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_followups_drafted',
    );
    // One drafted-event for round 2 (2 follow-ups). Round 3's plan event
    // is the "(none)" form which fires followups_none, not followups_drafted.
    expect(followupsDrafted).toHaveLength(1);

    const synthDone = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'deep_research_synthesis_completed',
    );
    expect(synthDone).toBeDefined();
    if (synthDone?.type !== 'plugin_event') throw new Error();
    expect((synthDone.payload as { totalFindings: number; rounds: number }).totalFindings).toBe(4);
    expect((synthDone.payload as { totalFindings: number; rounds: number }).rounds).toBe(2);
  });
});

/**
 * Wraps a FakeProvider and aborts `controller` the instant the SYNTHESIS stream
 * finishes — simulating the user cancelling DURING the synthesis provider call.
 * Aborting after the stream completes (not before) lets `collectSynthesis`
 * return its text normally, so the loop reaches the post-synthesis abort guard.
 */
function abortOnSynthesisProvider(
  inner: FakeProvider,
  controller: AbortController,
): LLMProvider {
  return {
    name: inner.name,
    models: inner.models,
    countTokens: (req) => inner.countTokens(req),
    async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
      const isSynthesis = req.messages.some((m) =>
        m.content.some(
          (c) => 'text' in c && c.text.includes('synthesizing a deep-research report'),
        ),
      );
      for await (const ev of inner.stream(req)) yield ev;
      if (isSynthesis) controller.abort();
    },
  };
}

function fakeResult(text: string, opts: { error?: string } = {}): SubagentResult {
  return {
    label: 'fake',
    childSessionId: asSessionId('fake-child'),
    text,
    stopReason: 'end_turn',
    ...(opts.error ? { error: { message: opts.error } } : {}),
  };
}
