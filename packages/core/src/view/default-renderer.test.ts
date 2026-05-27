import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_TAGS } from '@moxxy/sdk';
import { defaultViewRenderer } from './default-renderer.js';

describe('defaultViewRenderer', () => {
  it('is named moxxy/default and exposes the default allow-list', () => {
    expect(defaultViewRenderer.name).toBe('moxxy/default');
    expect(defaultViewRenderer.allowList).toBe(DEFAULT_VIEW_TAGS);
  });

  it('parse returns ok for a valid spec and the expected title', () => {
    const r = defaultViewRenderer.parse('<view title="hi"><text>x</text></view>');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.title).toBe('hi');
  });

  it('parse returns errors for an invalid spec', () => {
    const r = defaultViewRenderer.parse('<view><nope/></view>');
    expect(r.ok).toBe(false);
  });

  it('validate flags a hand-built unknown tag, passes a parsed doc', () => {
    const r = defaultViewRenderer.parse('<view><text>x</text></view>');
    if (!r.ok) throw new Error('expected ok');
    expect(defaultViewRenderer.validate(r.doc)).toEqual([]);
    const bad = defaultViewRenderer.validate({ root: { kind: 'element', tag: 'iframe', props: {}, children: [] } });
    expect(bad.length).toBeGreaterThan(0);
  });
});
