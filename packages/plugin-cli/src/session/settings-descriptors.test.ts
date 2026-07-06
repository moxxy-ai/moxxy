import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
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
      assertDefined(knob.next, `writable knob ${knob.id} has next`);
      const value = knob.next(empty);
      assertDefined(knob.dotPath, `writable knob ${knob.id} has dotPath`);
      const candidate = withPath(knob.dotPath, value);
      const res = moxxyConfigSchema.safeParse(candidate);
      expect(res.success, `${knob.id} → ${knob.dotPath} = ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('reasoning cycles off → on → on (high) → off', () => {
    const at = (r: unknown) => ({ context: { reasoning: r } }) as MoxxyConfig;
    const knob = findKnob('reasoning');
    assertDefined(knob, 'reasoning knob exists');
    assertDefined(knob.next, 'reasoning knob has next');
    expect(knob.next({} as MoxxyConfig)).toBe(true);
    expect(knob.next(at(true))).toEqual({ effort: 'high' });
    expect(knob.next(at({ effort: 'high' }))).toBe(false);
    expect(knob.current({} as MoxxyConfig)).toBe('off');
    expect(knob.current(at(true))).toBe('on');
    expect(knob.current(at({ effort: 'high' }))).toBe('on (high)');
  });

  it('booleans toggle against their documented defaults', () => {
    const cachingKnob = findKnob('caching');
    assertDefined(cachingKnob, 'caching knob exists');
    assertDefined(cachingKnob.next, 'caching knob has next');
    expect(cachingKnob.next({} as MoxxyConfig)).toBe(false); // default on
    const securityKnob = findKnob('security');
    assertDefined(securityKnob, 'security knob exists');
    assertDefined(securityKnob.next, 'security knob has next');
    expect(securityKnob.next({} as MoxxyConfig)).toBe(true); // default off
    const tuiHintsKnob = findKnob('tui-hints');
    assertDefined(tuiHintsKnob, 'tui-hints knob exists');
    assertDefined(tuiHintsKnob.next, 'tui-hints knob has next');
    expect(tuiHintsKnob.next({} as MoxxyConfig)).toBe(false); // default on
  });

  it('theme cycles default ↔ mono', () => {
    const knob = findKnob('tui-theme');
    assertDefined(knob, 'tui-theme knob exists');
    assertDefined(knob.next, 'tui-theme knob has next');
    expect(knob.next({} as MoxxyConfig)).toBe('mono');
    expect(knob.next({ tui: { theme: 'mono' } } as MoxxyConfig)).toBe('default');
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
