import { describe, expect, it } from 'vitest';
import type { MoxxyEventOfType, MoxxyEventType } from '@moxxy/sdk';
import { isMoxxyEventShape } from './event-shape.js';

/** Shared valid envelope for building variant samples. */
const base = {
  id: 'e1' as never,
  seq: 0,
  ts: 1,
  sessionId: 's1' as never,
  turnId: 't1' as never,
  source: 'user' as const,
};

/**
 * One valid sample of EVERY variant, typed as an exhaustive record over
 * `MoxxyEventType` — adding a variant to the sdk union fails this file's
 * typecheck until a sample (and thus guard coverage) is added, and a sample
 * that drifts from its variant's shape fails to compile.
 */
const samples: { readonly [T in MoxxyEventType]: MoxxyEventOfType<T> } = {
  user_prompt: { ...base, type: 'user_prompt', text: 'hello' },
  assistant_chunk: { ...base, type: 'assistant_chunk', delta: 'hi ' },
  assistant_message: {
    ...base,
    type: 'assistant_message',
    content: 'hi there',
    stopReason: 'end_turn',
  },
  reasoning_chunk: { ...base, type: 'reasoning_chunk', delta: 'thinking…' },
  reasoning_message: { ...base, type: 'reasoning_message', content: 'thought about it' },
  tool_call_requested: {
    ...base,
    type: 'tool_call_requested',
    callId: 'c1' as never,
    name: 'read_file',
    input: { path: '/tmp/x' },
  },
  tool_call_approved: {
    ...base,
    type: 'tool_call_approved',
    callId: 'c1' as never,
    decidedBy: 'policy',
    mode: 'allow',
  },
  tool_call_denied: {
    ...base,
    type: 'tool_call_denied',
    callId: 'c1' as never,
    decidedBy: 'resolver',
    reason: 'denied by user',
  },
  tool_result: { ...base, type: 'tool_result', callId: 'c1' as never, ok: true, output: 'done' },
  skill_invoked: {
    ...base,
    type: 'skill_invoked',
    skillId: 'sk1' as never,
    name: 'add-a-tool',
    reason: 'manual',
  },
  skill_created: {
    ...base,
    type: 'skill_created',
    skillId: 'sk1' as never,
    name: 'new-skill',
    path: '/tmp/skill.md',
    scope: 'user',
    originatingPrompt: 'make a skill',
  },
  plugin_registered: {
    ...base,
    type: 'plugin_registered',
    pluginId: 'p1' as never,
    name: '@moxxy/plugin-x',
    version: '1.0.0',
    kind: ['tools'],
  },
  plugin_unregistered: {
    ...base,
    type: 'plugin_unregistered',
    pluginId: 'p1' as never,
    name: '@moxxy/plugin-x',
    reason: 'reload',
  },
  mode_iteration: { ...base, type: 'mode_iteration', strategy: 'default', iteration: 2 },
  compaction: {
    ...base,
    type: 'compaction',
    compactor: 'summarizer',
    replacedRange: [0, 9],
    summary: 'earlier chatter',
    tokensSaved: 1234,
  },
  elision: {
    ...base,
    type: 'elision',
    elidedThrough: 40,
    stubbedRanges: [[0, 40]],
    elideConversational: false,
    conversationalRecallThreshold: 3,
    maxRecallBytes: 65536,
    neverElideTools: ['recall'],
    tokensSaved: 5678,
  },
  provider_request: { ...base, type: 'provider_request', provider: 'anthropic', model: 'claude' },
  provider_response: {
    ...base,
    type: 'provider_response',
    provider: 'anthropic',
    model: 'claude',
    outputTokens: 10,
  },
  error: { ...base, type: 'error', kind: 'retryable', message: 'rate limited' },
  abort: { ...base, type: 'abort', reason: 'user pressed esc' },
  plugin_event: {
    ...base,
    type: 'plugin_event',
    pluginId: 'p1' as never,
    subtype: 'frame',
    payload: { n: 1 },
  },
};

/** Round-trip through JSON, faithful to how the real read path sees a line. */
function throughJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('isMoxxyEventShape', () => {
  it('accepts a valid sample of every event variant (JSON round-tripped)', () => {
    for (const [type, sample] of Object.entries(samples)) {
      expect(isMoxxyEventShape(throughJson(sample)), `variant ${type}`).toBe(true);
    }
  });

  it('rejects non-object values and objects missing the envelope', () => {
    expect(isMoxxyEventShape(null)).toBe(false);
    expect(isMoxxyEventShape(undefined)).toBe(false);
    expect(isMoxxyEventShape('user_prompt')).toBe(false);
    expect(isMoxxyEventShape(42)).toBe(false);
    expect(isMoxxyEventShape([samples.user_prompt])).toBe(false);
    expect(isMoxxyEventShape({})).toBe(false);
    expect(isMoxxyEventShape({ foo: 'bar' })).toBe(false);
    // Each strict envelope field, individually missing or mistyped.
    const { id: _id, ...noId } = samples.user_prompt;
    expect(isMoxxyEventShape(noId)).toBe(false);
    const { seq: _seq, ...noSeq } = samples.user_prompt;
    expect(isMoxxyEventShape(noSeq)).toBe(false);
    const { ts: _ts, ...noTs } = samples.user_prompt;
    expect(isMoxxyEventShape(noTs)).toBe(false);
    const { type: _type, ...noType } = samples.user_prompt;
    expect(isMoxxyEventShape(noType)).toBe(false);
    expect(isMoxxyEventShape({ ...samples.user_prompt, seq: '0' })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.user_prompt, id: 7 })).toBe(false);
  });

  it('rejects non-finite numbers (JSON.parse CAN produce them: 1e999 → Infinity)', () => {
    const line = JSON.stringify({ ...samples.user_prompt, seq: 0 }).replace('"seq":0', '"seq":1e999');
    const parsed: unknown = JSON.parse(line);
    expect((parsed as { seq: number }).seq).toBe(Number.POSITIVE_INFINITY);
    expect(isMoxxyEventShape(parsed)).toBe(false);
  });

  it('tolerates absent sessionId/turnId/source (legacy logs) but rejects present-wrong-type', () => {
    const { sessionId: _s, turnId: _t, source: _src, ...bare } = samples.user_prompt;
    expect(isMoxxyEventShape(bare)).toBe(true);
    expect(isMoxxyEventShape({ ...bare, sessionId: null })).toBe(true);
    expect(isMoxxyEventShape({ ...samples.user_prompt, sessionId: 42 })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.user_prompt, turnId: {} })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.user_prompt, source: 9 })).toBe(false);
  });

  it('keeps an unknown (newer) event type with a valid envelope — floor-rollback forward-compat', () => {
    expect(isMoxxyEventShape({ ...base, type: 'surface_frame_from_the_future', blob: 'x' })).toBe(
      true,
    );
  });

  it('keeps a known variant carrying an unknown enum member — forward-compat on enum drift', () => {
    expect(
      isMoxxyEventShape({ ...samples.assistant_message, stopReason: 'brand_new_reason' }),
    ).toBe(true);
  });

  it('rejects known variants missing or mistyping their required fields', () => {
    const { text: _text, ...promptNoText } = samples.user_prompt;
    expect(isMoxxyEventShape(promptNoText)).toBe(false);
    expect(isMoxxyEventShape({ ...samples.user_prompt, text: 42 })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.tool_result, ok: 'yes' })).toBe(false);
    const { replacedRange: _rr, ...compactionNoRange } = samples.compaction;
    expect(isMoxxyEventShape(compactionNoRange)).toBe(false);
    expect(isMoxxyEventShape({ ...samples.compaction, replacedRange: ['0', '9'] })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.compaction, replacedRange: [0] })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.compaction, summary: null })).toBe(false);
    const { maxRecallBytes: _mrb, ...elisionSlim } = samples.elision;
    expect(isMoxxyEventShape(elisionSlim)).toBe(false);
    expect(isMoxxyEventShape({ ...samples.mode_iteration, iteration: 'two' })).toBe(false);
    expect(isMoxxyEventShape({ ...samples.plugin_registered, kind: 'tools' })).toBe(false);
  });

  it('tolerates a tool_call_requested whose input key was dropped by JSON.stringify', () => {
    // `input: undefined` at emit time serializes to a line with NO input key —
    // a presence check would drop a legitimate event.
    const line = { ...samples.tool_call_requested, input: undefined };
    expect(isMoxxyEventShape(throughJson(line))).toBe(true);
  });
});
