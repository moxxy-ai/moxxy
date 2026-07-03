import { describe, expect, it } from 'vitest';
import { moxxyConfigSchema, type MoxxyConfig } from '@moxxy/config';
import { findKnob, SETTINGS_KNOBS } from './settings-descriptors.js';
import { parseTuiKeyOverrides } from './helpers.js';

function withPath(path: string, value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cur = root;
  const segs = path.split('.');
  for (const [i, seg] of segs.entries()) {
    if (i === segs.length - 1) cur[seg] = value;
    else cur = cur[seg] = {} as Record<string, unknown>;
  }
  return root;
}

describe('SETTINGS_KNOBS', () => {
  it('every writable knob produces schema-valid configs for its next() value', () => {
    const empty = {} as MoxxyConfig;
    for (const knob of SETTINGS_KNOBS) {
      if (knob.kind === 'link' || knob.kind === 'readonly') continue;
      const value = knob.next!(empty);
      const candidate = withPath(knob.dotPath!, value);
      const res = moxxyConfigSchema.safeParse(candidate);
      expect(res.success, `${knob.id} → ${knob.dotPath} = ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('reasoning cycles off → on → on (high) → off', () => {
    const at = (r: unknown) => ({ context: { reasoning: r } }) as MoxxyConfig;
    const knob = findKnob('reasoning')!;
    expect(knob.next!({} as MoxxyConfig)).toBe(true);
    expect(knob.next!(at(true))).toEqual({ effort: 'high' });
    expect(knob.next!(at({ effort: 'high' }))).toBe(false);
    expect(knob.current({} as MoxxyConfig)).toBe('off');
    expect(knob.current(at(true))).toBe('on');
    expect(knob.current(at({ effort: 'high' }))).toBe('on (high)');
  });

  it('booleans toggle against their documented defaults', () => {
    expect(findKnob('caching')!.next!({} as MoxxyConfig)).toBe(false); // default on
    expect(findKnob('security')!.next!({} as MoxxyConfig)).toBe(true); // default off
    expect(findKnob('tui-hints')!.next!({} as MoxxyConfig)).toBe(false); // default on
  });

  it('theme cycles default ↔ mono', () => {
    const knob = findKnob('tui-theme')!;
    expect(knob.next!({} as MoxxyConfig)).toBe('mono');
    expect(knob.next!({ tui: { theme: 'mono' } } as MoxxyConfig)).toBe('default');
  });
});

describe('parseTuiKeyOverrides', () => {
  it('defaults without env, on bad JSON, and on collisions', () => {
    const dflt = { forceSend: 't', dropQueued: 'b', toggleTools: 'o' };
    expect(parseTuiKeyOverrides(undefined)).toEqual(dflt);
    expect(parseTuiKeyOverrides('not-json')).toEqual(dflt);
    expect(parseTuiKeyOverrides(JSON.stringify({ forceSend: 'b' }))).toEqual(dflt); // collides with dropQueued
    expect(parseTuiKeyOverrides(JSON.stringify({ forceSend: 'r' }))).toEqual(dflt); // voice key is fixed
    expect(parseTuiKeyOverrides(JSON.stringify({ forceSend: 'TT' }))).toEqual(dflt);
  });

  it('applies valid single-letter overrides', () => {
    expect(parseTuiKeyOverrides(JSON.stringify({ forceSend: 'f', toggleTools: 'x' }))).toEqual({
      forceSend: 'f',
      dropQueued: 'b',
      toggleTools: 'x',
    });
  });
});
