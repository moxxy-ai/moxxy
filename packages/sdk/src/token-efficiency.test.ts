import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  applyLazyTools,
  asEventId,
  asSessionId,
  asToolCallId,
  asTurnId,
  defineTool,
  estimateContextTokens,
  projectMessages,
  projectMessagesFromLog,
  summarizeSessionTokens,
  type EventLogReader,
  type MoxxyEvent,
  type MoxxyEventOfType,
  type MoxxyEventType,
  type ProviderMessage,
  type TurnId,
} from './index.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');
const t2 = asTurnId('t2');

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

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

const bigOutput = 'X'.repeat(5000);

// Log: t1 = old turn (anchor prompt + Read tool call/result + assistant text),
// elision through seq 3, then t2 = recent turn (kept verbatim).
function baseEvents(): MoxxyEvent[] {
  return [
    event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'the original task' }),
    event(1, {
      type: 'tool_call_requested',
      turnId: t1,
      source: 'model',
      callId: asToolCallId('c1'),
      name: 'Read',
      input: { file_path: '/a' },
    }),
    event(2, {
      type: 'tool_result',
      turnId: t1,
      source: 'tool',
      callId: asToolCallId('c1'),
      ok: true,
      output: bigOutput,
    }),
    event(3, {
      type: 'assistant_message',
      turnId: t1,
      source: 'model',
      content: 'old detailed answer '.repeat(20),
      stopReason: 'end_turn',
    }),
    event(4, {
      type: 'elision',
      turnId: t2,
      source: 'system',
      elidedThrough: 3,
      stubbedRanges: [[0, 3]],
      elideConversational: true,
      conversationalRecallThreshold: 4,
      maxRecallBytes: 32_768,
      neverElideTools: [],
      tokensSaved: 1200,
    }),
    event(5, { type: 'user_prompt', turnId: t2, source: 'user', text: 'the new task' }),
  ];
}

describe('elision in projectMessagesFromLog', () => {
  it('stubs old tool results but keeps the tool_use pairing intact', () => {
    const msgs = projectMessagesFromLog({ log: reader(baseEvents()) });
    const toolResult = msgs.find((m) => m.role === 'tool_result');
    expect(toolResult).toBeDefined();
    const block = toolResult!.content[0]!;
    expect(block.type === 'tool_result' && block.content).toMatch(/output elided/);
    // The tool_use block must still be present and reference the same callId.
    const assistantToolUse = msgs.find(
      (m) => m.role === 'assistant' && m.content.some((b) => b.type === 'tool_use'),
    );
    expect(assistantToolUse).toBeDefined();
    const useBlock = assistantToolUse!.content.find((b) => b.type === 'tool_use')!;
    const resBlock = toolResult!.content[0]!;
    expect(useBlock.type === 'tool_use' && useBlock.id).toBe(
      resBlock.type === 'tool_result' ? resBlock.toolUseId : 'mismatch',
    );
  });

  it('keeps the first user_prompt (task anchor) verbatim even when eliding', () => {
    const msgs = projectMessagesFromLog({ log: reader(baseEvents()) });
    const firstUser = msgs.find((m) => m.role === 'user');
    expect(firstUser!.content[0]).toMatchObject({ type: 'text', text: 'the original task' });
  });

  it('collapses old assistant text to a stub when elideConversational is on', () => {
    const msgs = projectMessagesFromLog({ log: reader(baseEvents()) });
    const stubbed = msgs.find(
      (m) => m.role === 'assistant' && m.content.some((b) => b.type === 'text' && /elided assistant turn/.test(b.text)),
    );
    expect(stubbed).toBeDefined();
  });

  it('keeps recent (post-HWM) content verbatim', () => {
    const msgs = projectMessagesFromLog({ log: reader(baseEvents()) });
    const recent = msgs.find(
      (m) => m.role === 'user' && m.content.some((b) => b.type === 'text' && b.text === 'the new task'),
    );
    expect(recent).toBeDefined();
  });

  it('reports the stable-prefix boundary at the elision HWM (the cross-turn cache breakpoint)', () => {
    const { messages, stablePrefixIndex } = projectMessages({ log: reader(baseEvents()) });
    // Messages: anchor user(0), assistant tool_use(1), tool_result stub(2),
    // assistant stub(3) — all from seqs ≤ HWM(3) — then the new task user(4),
    // which is post-HWM and volatile. So the stable prefix ends at index 3.
    expect(stablePrefixIndex).toBe(3);
    expect(messages).toHaveLength(5);
    // The boundary must be strictly before the rolling tail so the strategy
    // actually emits a distinct long-lived breakpoint.
    expect(stablePrefixIndex).toBeLessThan(messages.length - 1);
  });

  it('reports no stable prefix (-1) when elision is not active', () => {
    const noElision = baseEvents().filter((e) => e.type !== 'elision');
    const { stablePrefixIndex } = projectMessages({ log: reader(noElision) });
    expect(stablePrefixIndex).toBe(-1);
  });

  it('marks an elided result as "already recalled" once a recall references it', () => {
    const events = baseEvents();
    events.push(
      event(6, {
        type: 'tool_call_requested',
        turnId: t2,
        source: 'model',
        callId: asToolCallId('r1'),
        name: 'recall',
        input: { callId: 'c1' },
      }),
      event(7, {
        type: 'tool_result',
        turnId: t2,
        source: 'tool',
        callId: asToolCallId('r1'),
        ok: true,
        output: 'recalled full content',
      }),
    );
    const msgs = projectMessagesFromLog({ log: reader(events) });
    const stubs = msgs
      .flatMap((m) => m.content)
      .filter((b) => b.type === 'tool_result') as Array<{ type: 'tool_result'; content: string }>;
    expect(stubs.some((b) => /already recalled/.test(b.content))).toBe(true);
    // The recall's own result is pinned (full), never stubbed.
    expect(stubs.some((b) => b.content === 'recalled full content')).toBe(true);
  });
});

describe('estimateContextTokens', () => {
  it('counts an elided tool result as a stub, not its full payload', () => {
    const withElision = estimateContextTokens(reader(baseEvents()));
    const noElision = estimateContextTokens(
      reader(baseEvents().filter((e) => e.type !== 'elision')),
    );
    expect(withElision).toBeLessThan(noElision);
  });

  it('honors never-elide (estimate matches projection: kept full)', () => {
    // Same log, but the Read tool is on the never-elide list → its big output
    // stays full, so the estimate is materially larger.
    const elideable = estimateContextTokens(reader(baseEvents()));
    const neverElide = baseEvents().map((e) =>
      e.type === 'elision' ? { ...e, neverElideTools: ['Read'] } : e,
    );
    expect(estimateContextTokens(reader(neverElide))).toBeGreaterThan(elideable);
  });
});

describe('adaptive conversational elision', () => {
  // anchor + one long old assistant turn, elided, conversational on, threshold 1
  const evs = (extra: MoxxyEvent[] = []): MoxxyEvent[] => [
    event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'task' }),
    event(1, {
      type: 'assistant_message',
      turnId: t1,
      source: 'model',
      content: 'old answer '.repeat(40),
      stopReason: 'end_turn',
    }),
    event(2, {
      type: 'elision',
      turnId: t2,
      source: 'system',
      elidedThrough: 1,
      stubbedRanges: [[1, 1]],
      elideConversational: true,
      conversationalRecallThreshold: 1,
      maxRecallBytes: 32_768,
      neverElideTools: [],
      tokensSaved: 100,
    }),
    event(3, { type: 'user_prompt', turnId: t2, source: 'user', text: 'next' }),
    ...extra,
  ];

  const assistantText = (events: MoxxyEvent[]): string =>
    projectMessagesFromLog({ log: reader(events) })
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.content)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');

  it('stubs old text turns before the recall threshold is hit', () => {
    expect(assistantText(evs())).toMatch(/elided assistant turn/);
  });

  it('reverts old text turns to full once seq-recalls reach the threshold', () => {
    const withRecall = evs([
      event(4, {
        type: 'tool_call_requested',
        turnId: t2,
        source: 'model',
        callId: asToolCallId('rc'),
        name: 'recall',
        input: { seq: 1 },
      }),
    ]);
    const text = assistantText(withRecall);
    expect(text).toMatch(/old answer/);
    expect(text).not.toMatch(/elided assistant turn/);
  });
});

describe('maxRecallBytes cap', () => {
  it('stubs the oldest pinned recalls once the cap is exceeded', () => {
    const events: MoxxyEvent[] = [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'task' }),
      event(1, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: asToolCallId('ra'),
        name: 'recall',
        input: { callId: 'x' },
      }),
      event(2, {
        type: 'tool_result',
        turnId: t1,
        source: 'tool',
        callId: asToolCallId('ra'),
        ok: true,
        output: 'A'.repeat(300),
      }),
      event(3, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: asToolCallId('rb'),
        name: 'recall',
        input: { callId: 'y' },
      }),
      event(4, {
        type: 'tool_result',
        turnId: t1,
        source: 'tool',
        callId: asToolCallId('rb'),
        ok: true,
        output: 'B'.repeat(300),
      }),
      event(5, {
        type: 'elision',
        turnId: t2,
        source: 'system',
        elidedThrough: 4,
        stubbedRanges: [[0, 4]],
        elideConversational: false,
        conversationalRecallThreshold: 4,
        maxRecallBytes: 400, // fits the newest (rb=300) but not both
        neverElideTools: [],
        tokensSaved: 100,
      }),
      event(6, { type: 'user_prompt', turnId: t2, source: 'user', text: 'next' }),
    ];
    const results = projectMessagesFromLog({ log: reader(events) })
      .flatMap((m) => m.content)
      .filter((b): b is { type: 'tool_result'; content: string } => b.type === 'tool_result');
    const rb = results.find((b) => b.content.includes('B'.repeat(300)));
    const ra = results.find((b) => b.content.includes('recall("ra")'));
    expect(rb).toBeDefined(); // newest pinned, full
    expect(ra).toBeDefined(); // oldest over cap, stubbed
  });
});

describe('summarizeSessionTokens', () => {
  it('aggregates usage and computes cache savings', () => {
    const log = reader([
      event(0, {
        type: 'provider_response',
        turnId: t1,
        source: 'system',
        provider: 'anthropic',
        model: 'm',
        inputTokens: 1000,
        outputTokens: 100,
      }),
      event(1, {
        type: 'provider_response',
        turnId: t2,
        source: 'system',
        provider: 'anthropic',
        model: 'm',
        inputTokens: 200,
        cacheReadTokens: 1800,
        cacheCreationTokens: 100,
        outputTokens: 120,
      }),
    ]);
    const s = summarizeSessionTokens(log);
    expect(s.calls).toBe(2);
    expect(s.totalCacheRead).toBe(1800);
    expect(s.totalPrompt).toBe(1000 + 200 + 1800 + 100);
    // billed = 1200*1.0 + 1800*0.1 + 100*1.25 = 1505; uncached = 3100
    expect(Math.round(s.billedInputEq)).toBe(1505);
    expect(s.savedRatio).toBeGreaterThan(0.5);
    expect(s.cacheEffective).toBe(true);
  });

  it('flags cache ineffective when writing cache but never reading it', () => {
    const responses = Array.from({ length: 6 }, (_, i) =>
      event(i, {
        type: 'provider_response',
        turnId: t1,
        source: 'system',
        provider: 'anthropic',
        model: 'm',
        inputTokens: 1000,
        cacheCreationTokens: 1000, // writes happening...
        cacheReadTokens: 0, // ...but no reads → unstable prefix
        outputTokens: 50,
      }),
    );
    expect(summarizeSessionTokens(reader(responses)).cacheEffective).toBe(false);
  });

  it('does not false-alarm when caching is simply off (no writes)', () => {
    const responses = Array.from({ length: 6 }, (_, i) =>
      event(i, {
        type: 'provider_response',
        turnId: t1,
        source: 'system',
        provider: 'anthropic',
        model: 'm',
        inputTokens: 1000,
        outputTokens: 50,
      }),
    );
    expect(summarizeSessionTokens(reader(responses)).cacheEffective).toBe(true);
  });
});

describe('cache prefix stability', () => {
  // The cache only pays off if the projected prefix is byte-identical across
  // the inner iterations of a turn. Guards against anyone introducing per-call
  // nondeterminism (timestamps, reordering) into the projection.
  const turnEvents = (n: number): MoxxyEvent[] => {
    const out: MoxxyEvent[] = [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'task' }),
    ];
    let seq = 1;
    for (let i = 0; i < n; i++) {
      out.push(
        event(seq++, {
          type: 'tool_call_requested',
          turnId: t1,
          source: 'model',
          callId: asToolCallId(`c${i}`),
          name: 'Read',
          input: { file_path: `/f${i}` },
        }),
      );
      out.push(
        event(seq++, {
          type: 'tool_result',
          turnId: t1,
          source: 'tool',
          callId: asToolCallId(`c${i}`),
          ok: true,
          output: `result ${i}`,
        }),
      );
    }
    return out;
  };

  it('keeps the earlier-message prefix byte-identical when the next iteration appends', () => {
    const p1 = projectMessagesFromLog({ log: reader(turnEvents(2)) }, { systemPrompt: 'sys' });
    const p2 = projectMessagesFromLog({ log: reader(turnEvents(3)) }, { systemPrompt: 'sys' });
    expect(JSON.stringify(p2.slice(0, p1.length))).toBe(JSON.stringify(p1));
  });
});

describe('applyLazyTools', () => {
  const mk = (name: string) =>
    defineTool({ name, description: `desc ${name}`, inputSchema: z.object({}), handler: () => '' });
  const baseMsgs: ProviderMessage[] = [
    { role: 'system', content: [{ type: 'text', text: 'sys' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  ];

  it('keeps core tools, hides others into a system-prompt index', () => {
    const tools = [mk('Read'), mk('browser_open'), mk('memory_save')];
    const { messages, tools: sent } = applyLazyTools(baseMsgs, tools, reader([]));
    expect(sent.map((t) => t.name)).toEqual(['Read']);
    const sys = messages.find((m) => m.role === 'system')!;
    expect((sys.content[0] as { text: string }).text).toMatch(/Loadable tools/);
    expect((sys.content[0] as { text: string }).text).toMatch(/browser_open/);
  });

  it('includes a tool once it has been load_tool-ed', () => {
    const tools = [mk('Read'), mk('browser_open')];
    const log = reader([
      event(0, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: asToolCallId('l1'),
        name: 'load_tool',
        input: { name: 'browser_open' },
      }),
    ]);
    const { tools: sent } = applyLazyTools(baseMsgs, tools, log);
    expect(sent.map((t) => t.name).sort()).toEqual(['Read', 'browser_open']);
  });

  it('is a no-op (stable system prompt) when all tools are core', () => {
    const tools = [mk('Read'), mk('Bash')];
    const { messages, tools: sent } = applyLazyTools(baseMsgs, tools, reader([]));
    expect(sent).toHaveLength(2);
    expect(messages).toBe(baseMsgs); // same reference → byte-stable
  });

  // GOLDEN: the single-partition refactor (u125-2) must be byte-identical to the
  // prior two complementary `filter` passes for every input. Re-implement the
  // OLD logic inline and assert deep-equal output across many random tool sets.
  it('single-partition output is byte-identical to the old double-filter (golden)', () => {
    const ALWAYS = new Set([
      'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob',
      'recall', 'load_skill', 'load_tool', 'dispatch_agent',
    ]);
    const pool = [
      'Read', 'Write', 'Bash', 'Grep', 'browser_open', 'memory_save',
      'recall', 'load_tool', 'web_search', 'shell', 'foo', 'bar', 'baz', 'qux',
    ];
    // Old reference implementation of applyLazyTools' partition + injection.
    const oldApply = (
      msgs: ProviderMessage[],
      tools: ReturnType<typeof mk>[],
      loadedNames: Set<string>,
    ): { tools: string[]; injected: boolean } => {
      const hidden = tools.filter((t) => !ALWAYS.has(t.name) && !loadedNames.has(t.name));
      if (hidden.length === 0) return { tools: tools.map((t) => t.name), injected: false };
      const visible = tools.filter((t) => ALWAYS.has(t.name) || loadedNames.has(t.name));
      return { tools: visible.map((t) => t.name), injected: true };
    };

    let s = 12345;
    const rand = () => ((s = (s * 1664525 + 1013904329) >>> 0) / 0x100000000);
    for (let trial = 0; trial < 200; trial++) {
      // Random subset (with duplicates allowed) and a random loaded set.
      const names: string[] = [];
      const count = Math.floor(rand() * pool.length);
      for (let i = 0; i < count; i++) names.push(pool[Math.floor(rand() * pool.length)]!);
      const tools = names.map(mk);
      const loadedNames = new Set(
        pool.filter(() => rand() < 0.3),
      );
      const log = reader(
        [...loadedNames].map((name, i) =>
          event(i, {
            type: 'tool_call_requested',
            turnId: t1,
            source: 'model',
            callId: asToolCallId(`l${i}`),
            name: 'load_tool',
            input: { name },
          }),
        ),
      );
      const expected = oldApply(baseMsgs, tools, loadedNames);
      const actual = applyLazyTools(baseMsgs, tools, log);
      expect(actual.tools.map((t) => t.name)).toEqual(expected.tools);
      // Whether the system index was injected (messages !== baseMsgs) must match
      // the old `injected` flag exactly.
      expect(actual.messages !== baseMsgs).toBe(expected.injected);
    }
  });
});

describe('projectMessages compaction-range lookup (golden: binary cursor == linear scan)', () => {
  // GOLDEN for complexity-hotspots-5: the binary/merge compaction lookup that
  // replaced the per-event linear `eventInCompactionRange` must produce a
  // BYTE-IDENTICAL projection on logs with MANY non-overlapping compaction
  // ranges. We compare the real projection to an independent OLD-style
  // reference projector that uses the linear first-match lookup.

  type Ev = MoxxyEvent;
  interface Range { from: number; to: number; summary: string }

  // The exact pre-change lookup semantics (linear first-match in array order).
  const linearLookup = (seq: number, ranges: ReadonlyArray<Range>): Range | null => {
    for (const r of ranges) if (seq >= r.from && seq <= r.to) return r;
    return null;
  };

  // A minimal reference projector covering the event kinds we generate. It is a
  // faithful transcription of projectMessages' compaction/elision-free path:
  // every generated log here has NO elision event, so stubbing never fires and
  // the projection is a straight fold (which isolates the lookup change).
  const refProject = (events: ReadonlyArray<Ev>): ProviderMessage[] => {
    const ranges: Range[] = events
      .filter(
        (e): e is Extract<Ev, { type: 'compaction' }> =>
          e.type === 'compaction' &&
          e.tokensSaved > 0 &&
          e.summary.trim().length > 0 &&
          e.replacedRange[0] <= e.replacedRange[1],
      )
      .map((e) => ({ from: e.replacedRange[0], to: e.replacedRange[1], summary: e.summary }));
    const emitted = new Set<Range>();
    const msgs: ProviderMessage[] = [];
    const resolved = new Set<string>();
    for (const e of events) if (e.type === 'tool_result' || e.type === 'tool_call_denied') resolved.add(e.callId);
    let pending: ProviderMessage | null = null;
    const flush = () => {
      if (!pending) return;
      const f = pending;
      pending = null;
      msgs.push(f);
      for (const b of f.content) {
        if (b.type === 'tool_use' && !resolved.has(b.id)) {
          msgs.push({
            role: 'tool_result',
            content: [{ type: 'tool_result', toolUseId: b.id, content: '[tool call did not return a result — possibly interrupted or cancelled]', isError: true }],
          });
          resolved.add(b.id);
        }
      }
    };
    for (const e of events) {
      const r = linearLookup(e.seq, ranges);
      if (r) {
        if (!emitted.has(r)) {
          emitted.add(r);
          flush();
          msgs.push({ role: 'user', content: [{ type: 'text', text: `[summary of earlier turns]\n${r.summary}` }] });
        }
        continue;
      }
      switch (e.type) {
        case 'user_prompt':
          flush();
          msgs.push({ role: 'user', content: [{ type: 'text', text: e.text }] });
          break;
        case 'assistant_message':
          flush();
          if (e.content.trim().length === 0) break;
          msgs.push({ role: 'assistant', content: [{ type: 'text', text: e.content }] });
          break;
        case 'tool_call_requested':
          if (!pending) pending = { role: 'assistant', content: [] };
          (pending.content as Array<ProviderMessage['content'][number]>).push({ type: 'tool_use', id: e.callId, name: e.name, input: e.input });
          break;
        case 'tool_result': {
          flush();
          const text = e.error ? `[error:${e.error.kind}] ${e.error.message}` : typeof e.output === 'string' ? e.output : JSON.stringify(e.output ?? '');
          msgs.push({ role: 'tool_result', content: [{ type: 'tool_result', toolUseId: e.callId, content: text, isError: !e.ok }] });
          break;
        }
        default:
          break;
      }
    }
    flush();
    return msgs;
  };

  // Build a random log: alternating turns, with K non-overlapping compaction
  // ranges carved over a prefix of the seqs.
  const buildLog = (rand: () => number) => {
    const events: Ev[] = [];
    let seq = 0;
    const turnCount = 6 + Math.floor(rand() * 14);
    for (let i = 0; i < turnCount; i++) {
      events.push(event(seq++, { type: 'user_prompt', turnId: t1, source: 'user', text: `u${i}` }));
      if (rand() < 0.6) {
        const cid = asToolCallId(`c${i}`);
        events.push(event(seq++, { type: 'tool_call_requested', turnId: t1, source: 'model', callId: cid, name: 'Read', input: { i } }));
        // Most tool calls resolve; occasionally leave an orphan (no result).
        if (rand() < 0.85) events.push(event(seq++, { type: 'tool_result', turnId: t1, source: 'tool', callId: cid, ok: true, output: `r${i}` }));
      }
      events.push(event(seq++, { type: 'assistant_message', turnId: t1, source: 'model', content: rand() < 0.15 ? '' : `a${i}`, stopReason: 'end_turn' }));
    }
    const lastSeq = seq - 1;
    // Carve K non-overlapping ascending ranges over the first ~70% of seqs.
    const limit = Math.floor(lastSeq * 0.7);
    const ranges: Array<[number, number]> = [];
    let cursor = 0;
    const k = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < k && cursor < limit; i++) {
      const width = 1 + Math.floor(rand() * 4);
      const from = cursor;
      const to = Math.min(from + width, limit);
      ranges.push([from, to]);
      cursor = to + 1 + Math.floor(rand() * 2); // leave a gap between ranges
    }
    // Append compaction events (seq after everything; they don't fall in a range).
    for (const [from, to] of ranges) {
      events.push(event(seq++, { type: 'compaction', turnId: t2, source: 'compactor', compactor: 'summarize', replacedRange: [from, to], summary: `S(${from}-${to})`, tokensSaved: 10 }));
    }
    return events;
  };

  it('is byte-identical to the linear-scan reference across many random multi-range logs', () => {
    let s = 999;
    const rand = () => ((s = (s * 1664525 + 1013904329) >>> 0) / 0x100000000);
    for (let trial = 0; trial < 250; trial++) {
      const events = buildLog(rand);
      const actual = projectMessagesFromLog({ log: reader(events) });
      const expected = refProject(events);
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    }
  });

  it('locks a fixed many-range fixture (regression)', () => {
    const events: MoxxyEvent[] = [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'one' }),
      event(1, { type: 'assistant_message', turnId: t1, source: 'model', content: 'a1', stopReason: 'end_turn' }),
      event(2, { type: 'user_prompt', turnId: t1, source: 'user', text: 'two' }),
      event(3, { type: 'assistant_message', turnId: t1, source: 'model', content: 'a2', stopReason: 'end_turn' }),
      event(4, { type: 'user_prompt', turnId: t1, source: 'user', text: 'three' }),
      event(5, { type: 'assistant_message', turnId: t1, source: 'model', content: 'a3', stopReason: 'end_turn' }),
      event(6, { type: 'user_prompt', turnId: t2, source: 'user', text: 'recent' }),
      event(7, { type: 'compaction', turnId: t2, source: 'compactor', compactor: 'summarize', replacedRange: [0, 1], summary: 'sum-A', tokensSaved: 10 }),
      event(8, { type: 'compaction', turnId: t2, source: 'compactor', compactor: 'summarize', replacedRange: [2, 3], summary: 'sum-B', tokensSaved: 10 }),
      event(9, { type: 'compaction', turnId: t2, source: 'compactor', compactor: 'summarize', replacedRange: [4, 5], summary: 'sum-C', tokensSaved: 10 }),
    ];
    const msgs = projectMessagesFromLog({ log: reader(events) });
    expect(msgs).toEqual([
      { role: 'user', content: [{ type: 'text', text: '[summary of earlier turns]\nsum-A' }] },
      { role: 'user', content: [{ type: 'text', text: '[summary of earlier turns]\nsum-B' }] },
      { role: 'user', content: [{ type: 'text', text: '[summary of earlier turns]\nsum-C' }] },
      { role: 'user', content: [{ type: 'text', text: 'recent' }] },
    ]);
  });
});

describe('attachment projection in projectMessagesFromLog', () => {
  it('projects an image attachment to an image content block', () => {
    const msgs = projectMessagesFromLog({
      log: reader([
        event(0, {
          type: 'user_prompt',
          turnId: t1,
          source: 'user',
          text: 'what is this?',
          attachments: [{ kind: 'image', content: 'AAAA', mediaType: 'image/png', name: 'pic.png' }],
        }),
      ]),
    });
    expect(msgs[0].content).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
    ]);
  });

  it('projects a document attachment to a native document content block', () => {
    const msgs = projectMessagesFromLog({
      log: reader([
        event(0, {
          type: 'user_prompt',
          turnId: t1,
          source: 'user',
          text: 'summarize this',
          attachments: [
            { kind: 'document', content: 'JVBERi0=', mediaType: 'application/pdf', name: 'r.pdf' },
          ],
        }),
      ]),
    });
    expect(msgs[0].content).toEqual([
      { type: 'text', text: 'summarize this' },
      { type: 'document', mediaType: 'application/pdf', data: 'JVBERi0=', name: 'r.pdf' },
    ]);
  });

  it('inlines a file attachment as a labeled text block', () => {
    const msgs = projectMessagesFromLog({
      log: reader([
        event(0, {
          type: 'user_prompt',
          turnId: t1,
          source: 'user',
          text: 'review',
          attachments: [{ kind: 'file', content: 'const x = 1;', name: 'a.ts' }],
        }),
      ]),
    });
    expect(msgs[0].content).toEqual([
      { type: 'text', text: 'review' },
      { type: 'text', text: '[file a.ts]\nconst x = 1;' },
    ]);
  });
});
