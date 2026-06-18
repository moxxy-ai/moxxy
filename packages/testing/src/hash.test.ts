import { describe, expect, it } from 'vitest';
import { hashRequest } from './hash.js';

// hashRequest backs FakeProvider.byHash dispatch and RecordedProvider fixture
// lookup; its determinism + narrowing contract is load-bearing. (Key-order
// stability is covered in record-replay.test.ts; these pin the discriminating
// fields and the intentional tool-field narrowing on hash.ts line 9.)

describe('hashRequest', () => {
  it('changes when model / system / messages change', () => {
    const base = hashRequest({ model: 'm', system: 's', messages: [] } as never);
    expect(hashRequest({ model: 'other', system: 's', messages: [] } as never)).not.toBe(base);
    expect(hashRequest({ model: 'm', system: 'different', messages: [] } as never)).not.toBe(base);
    expect(
      hashRequest({
        model: 'm',
        system: 's',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      } as never),
    ).not.toBe(base);
  });

  it('treats a missing system the same as an empty system string', () => {
    expect(hashRequest({ model: 'm', messages: [] } as never)).toBe(
      hashRequest({ model: 'm', system: '', messages: [] } as never),
    );
  });

  it('changes when a tool name or description changes', () => {
    const tool = (name: string, description: string) =>
      hashRequest({ model: 'm', messages: [], tools: [{ name, description }] } as never);
    const base = tool('search', 'find things');
    expect(tool('lookup', 'find things')).not.toBe(base);
    expect(tool('search', 'find other things')).not.toBe(base);
  });

  it('ignores tool fields beyond name + description (intentional narrowing)', () => {
    const withExtra = hashRequest({
      model: 'm',
      messages: [],
      tools: [{ name: 't', description: 'd', inputSchema: { type: 'object', extra: 1 } }],
    } as never);
    const withoutExtra = hashRequest({
      model: 'm',
      messages: [],
      tools: [{ name: 't', description: 'd', inputSchema: { type: 'string' } }],
    } as never);
    expect(withExtra).toBe(withoutExtra);
  });
});
