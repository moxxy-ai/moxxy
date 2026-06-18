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
});
