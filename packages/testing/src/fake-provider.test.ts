import { describe, expect, it } from 'vitest';
import { FakeProvider, streamingTextReply, textReply, toolUseReply } from './fake-provider.js';
import { hashRequest } from './hash.js';

const req = () => ({
  model: 'fake-model',
  system: 'sys',
  messages: [
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] },
  ],
});

describe('FakeProvider', () => {
  it('streams a scripted text reply', async () => {
    const p = new FakeProvider({ script: [textReply('hello')] });
    const events = [];
    for await (const e of p.stream(req())) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['message_start', 'text_delta', 'message_end']);
  });

  it('streams scripted streaming text in chunks', async () => {
    const p = new FakeProvider({ script: [streamingTextReply(['he', 'll', 'o'])] });
    const deltas: string[] = [];
    for await (const e of p.stream(req())) {
      if (e.type === 'text_delta') deltas.push(e.delta);
    }
    expect(deltas.join('')).toBe('hello');
  });

  it('advances cursor across multiple calls', async () => {
    const p = new FakeProvider({ script: [textReply('one'), textReply('two')] });
    const drain = async () => {
      const out: string[] = [];
      for await (const e of p.stream(req())) if (e.type === 'text_delta') out.push(e.delta);
      return out.join('');
    };
    expect(await drain()).toBe('one');
    expect(await drain()).toBe('two');
  });

  it('throws when out of scripted replies', async () => {
    const p = new FakeProvider({ script: [] });
    await expect(async () => {
      for await (const _ of p.stream(req())) void _;
    }).rejects.toThrow(/no scripted reply/);
  });

  it('serves byHash overrides regardless of cursor', async () => {
    const r = req();
    const h = hashRequest(r);
    const p = new FakeProvider({ byHash: { [h]: textReply('via-hash') } });
    let final = '';
    for await (const e of p.stream(r)) if (e.type === 'text_delta') final += e.delta;
    expect(final).toBe('via-hash');
  });

  it('byHash miss throws a byHash error without advancing the cursor', async () => {
    // A non-empty byHash map that lacks the request's hash is a hard error,
    // not a cue to fall through to the script — and it must NOT consume a
    // cursor slot, so a later matching request still resolves.
    const matching = req();
    const h = hashRequest(matching);
    const p = new FakeProvider({ byHash: { [h]: textReply('matched') } });

    const mismatch = { ...req(), system: 'different-system' };
    await expect(async () => {
      for await (const _ of p.stream(mismatch)) void _;
    }).rejects.toThrow(/no byHash reply.*Known hashes:/s);

    // Cursor untouched: the matching request still resolves via byHash.
    let final = '';
    for await (const e of p.stream(matching)) if (e.type === 'text_delta') final += e.delta;
    expect(final).toBe('matched');
  });

  it('records received requests', async () => {
    const p = new FakeProvider({ script: [textReply('x')] });
    const r = req();
    for await (const _ of p.stream(r)) void _;
    expect(p.received).toHaveLength(1);
    expect(p.received[0]).toBe(r);
  });

  it('bounds the received buffer to maxReceived under high turn counts', async () => {
    // Worst case: a long-lived instance driven through many turns (goal-mode /
    // fuzz). Without a cap each request retains the full history → O(turns *
    // history). maxReceived must keep only the most recent N, dropping the
    // oldest, so retention stays bounded no matter how many turns run.
    const p = new FakeProvider({ script: Array.from({ length: 50 }, () => textReply('x')), maxReceived: 3 });
    for (let i = 0; i < 50; i++) {
      const r = { ...req(), system: `turn-${i}` };
      for await (const _ of p.stream(r)) void _;
    }
    expect(p.received).toHaveLength(3);
    // Newest three retained, oldest evicted.
    expect(p.received.map((r) => r.system)).toEqual(['turn-47', 'turn-48', 'turn-49']);
  });

  it('maxReceived=0 retains nothing (fully disables request capture)', async () => {
    const p = new FakeProvider({ script: [textReply('x'), textReply('y')], maxReceived: 0 });
    for await (const _ of p.stream(req())) void _;
    for await (const _ of p.stream(req())) void _;
    expect(p.received).toHaveLength(0);
  });

  it('reset() clears the received buffer and rewinds the cursor', async () => {
    const p = new FakeProvider({ script: [textReply('one'), textReply('two')] });
    for await (const _ of p.stream(req())) void _;
    expect(p.received).toHaveLength(1);
    p.reset();
    expect(p.received).toHaveLength(0);
    // Cursor rewound: the first scripted reply is served again.
    let out = '';
    for await (const e of p.stream(req())) if (e.type === 'text_delta') out += e.delta;
    expect(out).toBe('one');
  });

  it('toolUseReply emits expected event shape', async () => {
    const p = new FakeProvider({ script: [toolUseReply('Read', { file_path: 'x' }, 'c1')] });
    const events = [];
    for await (const e of p.stream(req())) events.push(e);
    expect(events.find((e) => e.type === 'tool_use_start')).toMatchObject({ name: 'Read', id: 'c1' });
    expect(events.find((e) => e.type === 'tool_use_end')).toMatchObject({ input: { file_path: 'x' } });
  });

  it('countTokens approximates length', async () => {
    const p = new FakeProvider();
    const n = await p.countTokens(req());
    expect(n).toBeGreaterThan(0);
  });

  it('countTokens tolerates circular / BigInt content blocks instead of throwing', async () => {
    const p = new FakeProvider();
    const circular: Record<string, unknown> = { type: 'tool_result', big: 1n };
    circular.self = circular; // both a circular ref and a BigInt — JSON.stringify would throw
    const n = await p.countTokens({
      model: 'fake-model',
      system: 'sys',
      messages: [{ role: 'user' as const, content: [circular as never] }],
    });
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it('yields a clean abort error when the request is already aborted', async () => {
    const p = new FakeProvider({ script: [textReply('should-not-stream')] });
    const ac = new AbortController();
    ac.abort();
    const events = [];
    for await (const e of p.stream({ ...req(), signal: ac.signal })) events.push(e);
    expect(events).toEqual([{ type: 'error', message: 'aborted', retryable: false }]);
    // The script cursor must NOT advance on an aborted request, so the scripted
    // reply is still available for the next (non-aborted) call.
    let out = '';
    for await (const e of p.stream(req())) if (e.type === 'text_delta') out += e.delta;
    expect(out).toBe('should-not-stream');
  });

  it('stops with an abort error when the signal fires mid-stream', async () => {
    const ac = new AbortController();
    const p = new FakeProvider({
      script: [streamingTextReply(['a', 'b', 'c'])],
      onRequest: () => ac.abort(), // aborts before any event is yielded
    });
    const types: string[] = [];
    for await (const e of p.stream({ ...req(), signal: ac.signal })) types.push(e.type);
    expect(types).toEqual(['error']);
  });
});
