import { describe, expect, it } from 'vitest';
import { actionPrompt, clientFrameSchema } from './protocol.js';

describe('clientFrameSchema', () => {
  it('accepts a well-formed prompt frame', () => {
    const r = clientFrameSchema.safeParse({ kind: 'prompt', text: 'hi' });
    expect(r.success).toBe(true);
  });

  it('accepts a well-formed action frame (with and without params)', () => {
    const base = { kind: 'action', actionId: 'a1', viewId: null, formValues: { from: 'SFO' } };
    expect(clientFrameSchema.safeParse({ ...base, action: { name: 'go' } }).success).toBe(true);
    expect(
      clientFrameSchema.safeParse({ ...base, viewId: 'v1', action: { name: 'go', params: { id: 1 } } })
        .success,
    ).toBe(true);
  });

  it.each([
    ['prompt without text (the crasher)', { kind: 'prompt' }],
    ['prompt with non-string text', { kind: 'prompt', text: 42 }],
    ['action without action', { kind: 'action', actionId: 'a', viewId: null, formValues: {} }],
    ['action without actionId', { kind: 'action', viewId: null, action: { name: 'x' }, formValues: {} }],
    ['action with non-string formValues', { kind: 'action', actionId: 'a', viewId: null, action: { name: 'x' }, formValues: { a: 1 } }],
    ['action with non-string action.name', { kind: 'action', actionId: 'a', viewId: null, action: { name: 7 }, formValues: {} }],
    ['unknown kind', { kind: 'nonsense' }],
    ['missing kind', {}],
    ['non-object', 'hello'],
    ['null', null],
  ])('rejects %s', (_label, frame) => {
    expect(clientFrameSchema.safeParse(frame).success).toBe(false);
  });
});

describe('actionPrompt', () => {
  it('embeds the action + values as a fenced [ui-action] block', () => {
    const p = actionPrompt({ name: 'search_flights' }, { from: 'SFO', to: 'JFK' });
    expect(p).toContain('[ui-action]');
    expect(p).toContain('```json');
    const json = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as { action: string; values: Record<string, string> };
    expect(parsed.action).toBe('search_flights');
    expect(parsed.values).toEqual({ from: 'SFO', to: 'JFK' });
  });

  it('includes params when present and is round-trippable JSON', () => {
    const p = actionPrompt({ name: 'select', params: { id: 'UA42' } }, {});
    const json = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as { action: string; params: Record<string, unknown>; values: unknown };
    expect(parsed.params).toEqual({ id: 'UA42' });
    expect(parsed.values).toEqual({});
  });

  it('omits params key when absent', () => {
    const p = actionPrompt({ name: 'x' }, { a: '1' });
    const json = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    expect(JSON.parse(json)).not.toHaveProperty('params');
  });
});
