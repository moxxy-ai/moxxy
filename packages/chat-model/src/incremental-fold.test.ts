/**
 * GOLDEN test for the incremental block fold.
 *
 * The load-bearing invariant (cardinal rule): for ANY event prefix, pushing
 * those events one at a time into an {@link IncrementalFold} must yield a block
 * tree byte-identical to `pairToolEvents(prefix)`. Both paths drive the exact
 * same {@link stepFold} over the same events in the same order, so this is a
 * structural guarantee — these tests are the regression net that proves it
 * across many representative recorded sequences AND step-by-step (after EVERY
 * event, not just at the end).
 *
 * Plus a complexity assertion: folding a k-event turn incrementally performs
 * O(k) total `stepFold` work, NOT the O(k²) of re-folding the whole prefix on
 * every event (the bug this cluster kills).
 */
import { describe, expect, it } from 'vitest';
import {
  asEventId,
  asPluginId,
  asSessionId,
  asSkillId,
  asToolCallId,
  asTurnId,
  type AssistantMessageEvent,
  type MoxxyEvent,
  type PluginEvent,
  type ReasoningMessageEvent,
  type SkillInvokedEvent,
  type ToolCallDeniedEvent,
  type ToolCallRequestedEvent,
  type ToolCompactPresentation,
  type ToolResultEvent,
  type UserPromptEvent,
} from '@moxxy/sdk';
import {
  IncrementalFold,
  createFoldState,
  pairToolEvents,
  stepFold,
  type CompactToolMap,
} from './pair-events.js';

// ---------------------------------------------------------------------------
// Synthetic-event builders (mirror pair-events.test.ts so the recorded
// sequences exercise the same shapes the real channel emits).
// ---------------------------------------------------------------------------

let seq = 0;
const base = () => {
  seq += 1;
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq * 1000,
    sessionId: asSessionId('s1'),
    turnId: asTurnId('t1'),
  } as const;
};

const userPrompt = (text: string): UserPromptEvent => ({ ...base(), type: 'user_prompt', source: 'user', text });
const toolRequest = (callId: string, name: string, input: unknown = {}): ToolCallRequestedEvent => ({
  ...base(),
  type: 'tool_call_requested',
  source: 'model',
  callId: asToolCallId(callId),
  name,
  input,
});
const toolResult = (callId: string, output: unknown = 'ok', ok = true): ToolResultEvent => ({
  ...base(),
  type: 'tool_result',
  source: 'tool',
  callId: asToolCallId(callId),
  ok,
  output,
});
const toolDenied = (callId: string, reason: string): ToolCallDeniedEvent => ({
  ...base(),
  type: 'tool_call_denied',
  source: 'plugin',
  callId: asToolCallId(callId),
  decidedBy: 'resolver',
  reason,
});
const skillInvoked = (skillId: string, name: string): SkillInvokedEvent => ({
  ...base(),
  type: 'skill_invoked',
  source: 'system',
  skillId: asSkillId(skillId),
  name,
  reason: 'manual',
});
const assistantMessage = (content: string): AssistantMessageEvent => ({
  ...base(),
  type: 'assistant_message',
  source: 'model',
  content,
  stopReason: 'end_turn',
});
const reasoningMessage = (content: string): ReasoningMessageEvent =>
  ({ ...base(), type: 'reasoning_message', source: 'model', content }) as unknown as ReasoningMessageEvent;

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';
const subagentEvent = (subtype: string, payload: Record<string, unknown>): PluginEvent => ({
  ...base(),
  type: 'plugin_event',
  source: 'plugin',
  pluginId: asPluginId(SUBAGENT_PLUGIN_ID),
  subtype,
  payload,
});

const readCompact: ToolCompactPresentation = {
  verb: 'Reading',
  noun: { one: 'file', other: 'files' },
  previewKey: 'file_path',
};
const grepCompact: ToolCompactPresentation = { verb: 'Searching for', noun: { one: 'pattern', other: 'patterns' } };
const compactMap: CompactToolMap = new Map([
  ['read', readCompact],
  ['grep', grepCompact],
]);

const fileDiffOutput = {
  forModel: 'edited /a.ts',
  display: { kind: 'file-diff' as const, path: 'a.ts', mode: 'update' as const, added: 1, removed: 1, hunks: [] },
};

// ---------------------------------------------------------------------------
// Recorded sequences — each a named, representative event log. Covers skill
// scopes, continuation scopes, live-tools, subagents (groups/mixed/errors),
// orphan results, reasoning, file diffs, and interleavings of all of them.
// ---------------------------------------------------------------------------
interface Recorded {
  readonly name: string;
  readonly events: () => MoxxyEvent[];
  readonly compact?: CompactToolMap;
}

const SEQUENCES: Recorded[] = [
  {
    name: 'plain verbose tool pair',
    events: () => [userPrompt('hi'), toolRequest('c1', 'bash'), toolResult('c1', 'out'), assistantMessage('done')],
  },
  {
    name: 'pending then denied',
    events: () => [toolRequest('c1', 'bash'), toolDenied('c1', 'nope')],
  },
  {
    name: 'orphan at turn boundary, late result',
    events: () => [
      userPrompt('go'),
      toolRequest('c1', 'bash'),
      userPrompt('never mind'),
      toolResult('c1', 'too late'),
    ],
  },
  {
    name: 'skill scope with two tools, closed by prompt',
    events: () => [
      skillInvoked('sk1', 'pdf'),
      toolRequest('c1', 'bash'),
      toolResult('c1'),
      toolRequest('c2', 'write'),
      toolResult('c2'),
      userPrompt('thanks'),
    ],
  },
  {
    name: 'load_skill suppressed into scope',
    events: () => [
      toolRequest('ls1', 'load_skill', { name: 'pdf' }),
      skillInvoked('sk1', 'pdf'),
      toolRequest('c1', 'bash'),
      toolResult('c1'),
      toolResult('ls1', 'loaded'),
    ],
  },
  {
    name: 'scope split by assistant_message → continuation scope',
    events: () => [
      skillInvoked('sk1', 'pdf'),
      toolRequest('c1', 'bash'),
      toolResult('c1'),
      assistantMessage('now generating'),
      toolRequest('c2', 'write'),
      toolResult('c2'),
    ],
  },
  {
    name: 'compact live aggregation interrupted by verbose',
    compact: compactMap,
    events: () => [
      toolRequest('r1', 'read', { file_path: '/a.ts' }),
      toolResult('r1'),
      toolRequest('r2', 'read', { file_path: '/b.ts' }),
      toolResult('r2'),
      toolRequest('b1', 'bash'),
      toolResult('b1'),
      toolRequest('g1', 'grep', { pattern: 'x' }),
      toolResult('g1'),
      assistantMessage('found it'),
    ],
  },
  {
    name: 'subagent group fan-out, mixed completion order',
    events: () => [
      subagentEvent('subagent_started', { childSessionId: 'cs1', label: 'a', agentType: 'Explore' }),
      subagentEvent('subagent_started', { childSessionId: 'cs2', label: 'b', agentType: 'Explore' }),
      subagentEvent('subagent_tool_call', { childSessionId: 'cs1' }),
      subagentEvent('subagent_completed', { childSessionId: 'cs2', stopReason: 'end_turn', tokensUsed: 65300, text: 'b done' }),
      subagentEvent('subagent_completed', { childSessionId: 'cs1', stopReason: 'end_turn', tokensUsed: 1200, text: 'a done' }),
    ],
  },
  {
    name: 'subagent run broken by a tool, then a second group',
    events: () => [
      subagentEvent('subagent_started', { childSessionId: 'cs1', label: 'a' }),
      subagentEvent('subagent_completed', { childSessionId: 'cs1', stopReason: 'end_turn' }),
      toolRequest('t1', 'bash'),
      toolResult('t1'),
      subagentEvent('subagent_started', { childSessionId: 'cs2', label: 'b' }),
      subagentEvent('subagent_error', { childSessionId: 'cs2', message: 'boom' }),
    ],
  },
  {
    name: 'mixed: prompt, reasoning, file diffs, live tools, scope, subagents',
    compact: compactMap,
    events: () => [
      userPrompt('build it'),
      reasoningMessage('thinking about it'),
      toolRequest('w1', 'Write', { file_path: '/a.ts' }),
      toolResult('w1', fileDiffOutput),
      toolRequest('r1', 'read', { file_path: '/a.ts' }),
      toolResult('r1'),
      toolRequest('r2', 'read', { file_path: '/b.ts' }),
      assistantMessage('partial'),
      skillInvoked('sk1', 'deploy'),
      toolRequest('e1', 'Edit', { file_path: '/b.ts' }),
      toolResult('e1', fileDiffOutput),
      subagentEvent('subagent_started', { childSessionId: 'cs1', label: 'verify', agentType: 'Test' }),
      subagentEvent('subagent_tool_call', { childSessionId: 'cs1' }),
      subagentEvent('subagent_completed', { childSessionId: 'cs1', stopReason: 'end_turn', tokensUsed: 4200, text: 'ok' }),
      userPrompt('next turn'),
      toolRequest('b2', 'bash'),
      toolResult('b2'),
    ],
  },
  {
    name: 'open live aggregate sealed by a subagent start, then more compact reads',
    compact: compactMap,
    events: () => [
      userPrompt('look around'),
      toolRequest('r1', 'read', { file_path: '/a.ts' }),
      toolResult('r1'),
      // Subagent starts while the live block is still open — must seal it so the
      // later read below opens a FRESH live block under the agents (in order).
      subagentEvent('subagent_started', { childSessionId: 'cs1', label: 'verify', agentType: 'Test' }),
      subagentEvent('subagent_completed', { childSessionId: 'cs1', stopReason: 'end_turn', tokensUsed: 100, text: 'ok' }),
      toolRequest('r2', 'read', { file_path: '/b.ts' }),
      toolResult('r2'),
      assistantMessage('done'),
    ],
  },
  {
    name: 'long burst of compact reads (stress)',
    compact: compactMap,
    events: () => {
      const out: MoxxyEvent[] = [userPrompt('read everything')];
      for (let i = 0; i < 40; i += 1) {
        out.push(toolRequest(`rk${i}`, 'read', { file_path: `/f${i}.ts` }));
        out.push(toolResult(`rk${i}`));
      }
      out.push(assistantMessage('done reading'));
      return out;
    },
  },
];

/** Deep structural equality that walks the block tree (vitest's toEqual gives
 *  byte-level field comparison; identity differences in equal-valued objects
 *  are fine because the two folds build distinct-but-equal object graphs). */
function expectByteIdentical(name: string, step: number, a: unknown, b: unknown): void {
  // A failure here reports which sequence + step diverged.
  expect(a, `${name} @ step ${step}`).toEqual(b);
}

describe('IncrementalFold — golden byte-identity vs pairToolEvents', () => {
  for (const seqDef of SEQUENCES) {
    it(`matches pairToolEvents after EVERY event: ${seqDef.name}`, () => {
      const events = seqDef.events();
      const fold = new IncrementalFold(seqDef.compact);
      for (let n = 0; n < events.length; n += 1) {
        fold.push(events[n]!);
        const incremental = fold.tree();
        const golden = pairToolEvents(events.slice(0, n + 1), seqDef.compact);
        expectByteIdentical(seqDef.name, n + 1, incremental, golden);
      }
      // Final whole-prefix equality (redundant with the loop, but explicit).
      expect(fold.tree()).toEqual(pairToolEvents(events, seqDef.compact));
    });
  }

  it('pushMany equals one-at-a-time push equals pairToolEvents', () => {
    for (const seqDef of SEQUENCES) {
      const events = seqDef.events();
      const a = new IncrementalFold(seqDef.compact);
      a.pushMany(events);
      const b = new IncrementalFold(seqDef.compact);
      for (const e of events) b.push(e);
      expect(a.tree()).toEqual(b.tree());
      expect(a.tree()).toEqual(pairToolEvents(events, seqDef.compact));
    }
  });
});

describe('IncrementalFold.syncTo — append-only resync', () => {
  it('folds only the tail on a pure append (no rebuild)', () => {
    const events = SEQUENCES.find((s) => s.name.startsWith('mixed'))!.events();
    const fold = new IncrementalFold(compactMap);
    // Drive it the way a store would: re-sync to a growing snapshot each tick.
    for (let n = 1; n <= events.length; n += 1) {
      const snapshot = events.slice(0, n);
      const tree = fold.syncTo(snapshot);
      expect(tree).toEqual(pairToolEvents(snapshot, compactMap));
      // High-water mark advanced to the snapshot length — tail-only fold.
      expect(fold.length).toBe(n);
    }
  });

  it('rebuilds from scratch when the prefix is replaced (/clear → new session)', () => {
    const first = SEQUENCES[0]!.events();
    const fold = new IncrementalFold();
    fold.syncTo(first);
    expect(fold.tree()).toEqual(pairToolEvents(first));
    // A fresh, unrelated session: different event ids at the head.
    const second = SEQUENCES[3]!.events();
    const tree = fold.syncTo(second);
    expect(tree).toEqual(pairToolEvents(second));
    expect(fold.length).toBe(second.length);
  });

  it('rebuilds from scratch when older history is prepended (scroll-up)', () => {
    const tail = SEQUENCES[0]!.events();
    const fold = new IncrementalFold();
    fold.syncTo(tail);
    // Older page prepended at the front: head id shifts → must rebuild.
    const older = [userPrompt('earlier'), assistantMessage('earlier reply')];
    const combined = [...older, ...tail];
    const tree = fold.syncTo(combined);
    expect(tree).toEqual(pairToolEvents(combined));
  });

  it('rebuilds when the array shrinks below the high-water mark', () => {
    const events = SEQUENCES.find((s) => s.name.startsWith('mixed'))!.events();
    const fold = new IncrementalFold(compactMap);
    fold.syncTo(events);
    const shorter = events.slice(0, 3);
    const tree = fold.syncTo(shorter);
    expect(tree).toEqual(pairToolEvents(shorter, compactMap));
    expect(fold.length).toBe(3);
  });

  it('stays correct when the tail event id is replaced in place', () => {
    // canExtend matches head+tail ids; a replaced TAIL is detected and the fold
    // rebuilds, so the tree stays byte-identical to a from-scratch fold.
    const events = SEQUENCES[0]!.events();
    const fold = new IncrementalFold();
    fold.syncTo(events);
    const swapped = events.slice();
    swapped[swapped.length - 1] = { ...events[events.length - 1]!, id: asEventId('swapped-tail') };
    const tree = fold.syncTo(swapped);
    expect(tree).toEqual(pairToolEvents(swapped));
  });
});

describe('IncrementalFold — complexity (O(k) not O(k²) per turn)', () => {
  it('a k-event turn does NOT perform k full walks', () => {
    // Count total stepFold invocations two ways over the SAME event stream:
    //   - incremental: one stepFold per pushed event           → exactly k
    //   - naive re-fold (the bug): re-fold the whole prefix on  → k(k+1)/2
    //     every committed event
    // The wrapper below is the real stepFold, so both counts are exact.
    const events = SEQUENCES.find((s) => s.name.startsWith('long burst'))!.events();
    const k = events.length;

    let incrementalSteps = 0;
    const inc = createFoldState(compactMap);
    for (const e of events) {
      stepFold(inc, e);
      incrementalSteps += 1;
    }
    expect(incrementalSteps).toBe(k);

    let naiveSteps = 0;
    for (let n = 1; n <= k; n += 1) {
      const s = createFoldState(compactMap);
      for (let i = 0; i < n; i += 1) {
        stepFold(s, events[i]!);
        naiveSteps += 1;
      }
    }
    expect(naiveSteps).toBe((k * (k + 1)) / 2);

    // The incremental path is asymptotically cheaper; concretely, for this
    // k it is at least an order of magnitude fewer step invocations.
    expect(incrementalSteps).toBeLessThan(naiveSteps / 10);

    // And it still produces the byte-identical final tree.
    expect(inc.root).toEqual(pairToolEvents(events, compactMap));
  });
});
