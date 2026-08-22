import { describe, expect, it } from 'vitest';
import { diffRendering, renderingOf } from './diff.js';
import type { AxNode } from './tree.js';

/**
 * The whole tree, every read, is what a heavy page costs: ~9,700 tokens for
 * Canva's home page, ~25,300 for a Wikipedia article. Almost all of it is the
 * same as the read before — the agent clicked one thing.
 *
 * Sending only what moved is the fix, and it works now that a uid means the same
 * element from one read to the next. Keyed by uid rather than by position, so a
 * row that merely shifted down is not "changed".
 */
const node = (uid: string, role: string, name: string, children: AxNode[] = []): AxNode =>
  ({ uid, role, name, children }) as AxNode;

const page = (...children: AxNode[]): AxNode => node('1', 'RootWebArea', 'Sklep', children);

describe('renderingOf', () => {
  it('gives one line per element, keyed by uid', () => {
    const lines = renderingOf(page(node('2', 'button', 'Kup')));

    expect(lines.get('1')).toContain('RootWebArea');
    expect(lines.get('2')).toContain('Kup');
  });
});

describe('diffRendering', () => {
  const before = renderingOf(page(node('2', 'heading', 'Koty'), node('3', 'link', 'Stara oferta')));

  it('says nothing about a page that did not move', () => {
    expect(diffRendering(before, before)).toEqual([]);
  });

  it('reports what appeared', () => {
    const after = renderingOf(page(node('2', 'heading', 'Koty'), node('3', 'link', 'Stara oferta'), node('9', 'button', 'Zamknij')));

    expect(diffRendering(before, after)).toEqual([expect.stringMatching(/^\+ .*Zamknij/)]);
  });

  it('reports what went away', () => {
    const after = renderingOf(page(node('2', 'heading', 'Koty')));

    expect(diffRendering(before, after)).toEqual([expect.stringMatching(/^- .*Stara oferta/)]);
  });

  it('reports what changed, and what it used to say', () => {
    const after = renderingOf(page(node('2', 'heading', 'Koty domowe'), node('3', 'link', 'Stara oferta')));

    const out = diffRendering(before, after);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^~ /);
    expect(out[0]).toContain('Koty domowe');
    expect(out[0]).toContain('Koty');
  });

  it('does not call a row that merely moved down a change', () => {
    // This is the point of keying by uid. Positionally everything shifted; in
    // terms of what the page says, one thing was added.
    const after = renderingOf(page(node('9', 'button', 'Nowy'), node('2', 'heading', 'Koty'), node('3', 'link', 'Stara oferta')));

    expect(diffRendering(before, after)).toEqual([expect.stringMatching(/^\+ .*Nowy/)]);
  });

  it('puts removals before additions, so a replacement reads as one thing', () => {
    const after = renderingOf(page(node('2', 'heading', 'Koty'), node('9', 'link', 'Nowa oferta')));

    const out = diffRendering(before, after);

    expect(out[0]).toMatch(/^- /);
    expect(out[1]).toMatch(/^\+ /);
  });
});
