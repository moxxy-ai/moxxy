import type {
  EventLogReader,
  MoxxyEvent,
  MoxxyEventOfType,
  MoxxyEventType,
  TurnId,
} from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { classify, gatherSignals, suggestName, type ClassifySignals } from './classify.js';

const empty: ClassifySignals = { failedTools: [], errorMessages: [], registeredTools: [] };

// Minimal EventLogReader backed by a plain array — gatherSignals only uses
// `length`, `slice` and `ofType`, so we stub just those faithfully.
function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> =>
      events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

function ev(seq: number, partial: Record<string, unknown>): MoxxyEvent {
  return {
    id: `e${seq}`,
    seq,
    ts: seq,
    sessionId: 'sess',
    turnId: 'turn',
    source: 'system',
    ...partial,
  } as unknown as MoxxyEvent;
}

describe('classify', () => {
  it('escalates to core when the error mentions core internals', () => {
    const r = classify(
      { trigger: 'error' },
      { ...empty, errorMessages: ['TypeError in packages/core/src/run-turn.ts'] },
    );
    expect(r.tier).toBe('core');
  });

  it('recommends a plugin when a called tool is not registered', () => {
    const r = classify(
      { trigger: 'error' },
      { failedTools: ['fetch_weather'], errorMessages: ['no tool'], registeredTools: ['Read', 'Bash'] },
    );
    expect(r.tier).toBe('plugin');
    expect(r.candidateName).toBeDefined();
  });

  it('recommends a skill when an existing tool was misused', () => {
    const r = classify(
      { trigger: 'error', text: 'it keeps using the wrong path' },
      { failedTools: ['Read'], errorMessages: ['ENOENT'], registeredTools: ['Read'] },
    );
    expect(r.tier).toBe('skill');
  });

  it('recommends a plugin to wrap an existing misbehaving tool when override is implied', () => {
    const r = classify(
      { trigger: 'request', text: 'wrap the Read tool to truncate huge files' },
      { failedTools: ['Read'], errorMessages: [], registeredTools: ['Read'] },
    );
    expect(r.tier).toBe('plugin');
  });

  it('treats a procedure request as a skill', () => {
    const r = classify(
      { trigger: 'request', text: 'always run the linter before committing' },
      empty,
    );
    expect(r.tier).toBe('skill');
  });

  it('treats a new-capability request as a plugin', () => {
    const r = classify(
      { trigger: 'request', text: 'add a tool that calls the GitHub API' },
      empty,
    );
    expect(r.tier).toBe('plugin');
  });

  it('defaults ambiguous requests to the plugin tier', () => {
    const r = classify({ trigger: 'request', text: 'do the thing' }, empty);
    expect(r.tier).toBe('plugin');
  });
});

describe('suggestName', () => {
  it('builds a kebab slug, dropping stop words', () => {
    expect(suggestName('add a tool that calls the GitHub API')).toBe('tool-calls-github-api');
  });
  it('returns undefined for empty input', () => {
    expect(suggestName(undefined)).toBeUndefined();
  });
});

describe('gatherSignals', () => {
  it('correlates failed tool_result events back to their call name', () => {
    const events = [
      ev(0, { type: 'tool_call_requested', callId: 'c1', name: 'fetch_weather', input: {} }),
      ev(1, {
        type: 'tool_result',
        callId: 'c1',
        ok: false,
        error: { message: 'boom', kind: 'threw' },
      }),
    ];
    const sig = gatherSignals(reader(events), ['Read']);
    expect(sig.failedTools).toEqual(['fetch_weather']);
    expect(sig.errorMessages).toEqual(['boom']);
    expect(sig.registeredTools).toEqual(['Read']);
  });

  it('ignores successful results and collects standalone error events', () => {
    const events = [
      ev(0, { type: 'tool_call_requested', callId: 'c1', name: 'Read', input: {} }),
      ev(1, { type: 'tool_result', callId: 'c1', ok: true, output: 'fine' }),
      ev(2, { type: 'error', message: 'session-level failure' }),
    ];
    const sig = gatherSignals(reader(events), []);
    expect(sig.failedTools).toEqual([]);
    expect(sig.errorMessages).toEqual(['session-level failure']);
  });

  it('records the error message for a failed-but-unregistered call name', () => {
    // A tool_result whose callId has no matching tool_call_requested still
    // contributes its error message, but cannot name a failed tool.
    const events = [
      ev(0, {
        type: 'tool_result',
        callId: 'orphan',
        ok: false,
        error: { message: 'no request seen', kind: 'threw' },
      }),
    ];
    const sig = gatherSignals(reader(events), []);
    expect(sig.failedTools).toEqual([]);
    expect(sig.errorMessages).toEqual(['no request seen']);
  });

  it('only inspects events within the lookback window', () => {
    // The request is far in the past; with a tiny lookback only the recent
    // failing result is scanned. The callName map is still built from the
    // whole log, so the correlation resolves even though the request itself
    // is outside the window.
    const events = [
      ev(0, { type: 'tool_call_requested', callId: 'c1', name: 'old_tool', input: {} }),
      ev(1, { type: 'tool_result', callId: 'c1', ok: false, error: { message: 'stale', kind: 'threw' } }),
      ev(2, { type: 'tool_call_requested', callId: 'c2', name: 'new_tool', input: {} }),
      ev(3, { type: 'tool_result', callId: 'c2', ok: false, error: { message: 'fresh', kind: 'threw' } }),
    ];
    const sig = gatherSignals(reader(events), [], 2);
    // Only seq 2..3 are in the window, so only new_tool's failure is recorded.
    expect(sig.failedTools).toEqual(['new_tool']);
    expect(sig.errorMessages).toEqual(['fresh']);
  });

  it('dedupes a tool that fails repeatedly', () => {
    const events = [
      ev(0, { type: 'tool_call_requested', callId: 'c1', name: 'flaky', input: {} }),
      ev(1, { type: 'tool_result', callId: 'c1', ok: false, error: { message: 'e1', kind: 'threw' } }),
      ev(2, { type: 'tool_call_requested', callId: 'c2', name: 'flaky', input: {} }),
      ev(3, { type: 'tool_result', callId: 'c2', ok: false, error: { message: 'e2', kind: 'threw' } }),
    ];
    const sig = gatherSignals(reader(events), []);
    expect(sig.failedTools).toEqual(['flaky']);
    expect(sig.errorMessages).toEqual(['e1', 'e2']);
  });
});
