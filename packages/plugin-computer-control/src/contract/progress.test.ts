import { describe, expect, it } from 'vitest';
import { ProgressTracker, fingerprint, looksDifferent } from './progress.js';
import type { AppTree } from '@moxxy/jev';

const tree = (value: string): AppTree => ({ app: 'Notes', window: 'Untitled', elements: [{ key: 'w/text', index: 1, depth: 1, role: 'text area', value }] });

describe('fingerprint', () => {
  it('changes with the tree or the screenshot, and only with them', () => {
    const image = { base64: 'AAAA' };
    expect(fingerprint(tree('a'), image)).toBe(fingerprint(tree('a'), { base64: 'AAAA' }));
    expect(fingerprint(tree('a'), image)).not.toBe(fingerprint(tree('b'), image));
    // A canvas changes only in pixels; that is progress too.
    expect(fingerprint(tree('a'), image)).not.toBe(fingerprint(tree('a'), { base64: 'BBBB' }));
    expect(fingerprint(tree('a'))).not.toBe(fingerprint(tree('a'), image));
  });
});

describe('looksDifferent', () => {
  const framed = (value: string): AppTree => ({ ...tree(value), elements: tree(value).elements.map((element) => ({ ...element, frame: { x: 1, y: 2, width: 3, height: 4 } })) });

  it('compares pictures only when both looks have one, and otherwise the elements without their places', () => {
    const image = { mediaType: 'image/png' as const, base64: 'AAAA', width: 1, height: 1 };
    expect(looksDifferent({ tree: framed('a'), screenshot: image }, { tree: tree('a') })).toBe(false);
    expect(looksDifferent({ tree: framed('a'), screenshot: image }, { tree: tree('b') })).toBe(true);
    expect(looksDifferent({ tree: framed('a'), screenshot: image }, { tree: framed('a'), screenshot: { ...image, base64: 'BBBB' } })).toBe(true);
    expect(looksDifferent({ tree: tree('a') }, { tree: tree('a') })).toBe(false);
  });
});

describe('ProgressTracker', () => {
  it('counts how many times in a row the same action left the app unchanged', () => {
    const progress = new ProgressTracker();
    expect(progress.record('notes', 'click 2', false)).toBe(1);
    expect(progress.record('notes', 'click 2', false)).toBe(2);
    expect(() => progress.check('notes', 'click 2')).toThrow(expect.objectContaining({ code: 'no_progress' }));
  });

  it('starts over after a change, another action or another app', () => {
    const progress = new ProgressTracker();
    progress.record('notes', 'click 2', false);
    expect(progress.record('notes', 'click 2', true)).toBe(0);
    expect(progress.record('notes', 'click 2', false)).toBe(1);
    expect(progress.record('notes', 'press Return', false)).toBe(1);
    progress.record('notes', 'press Return', false);
    expect(() => progress.check('notes', 'click 2')).not.toThrow();
    expect(() => progress.check('mail', 'press Return')).not.toThrow();
  });

  it('forgets an app whose action did not go through', () => {
    const progress = new ProgressTracker();
    progress.record('notes', 'click 2', false);
    progress.record('notes', 'click 2', false);
    progress.forget('notes');
    expect(() => progress.check('notes', 'click 2')).not.toThrow();
  });
});
