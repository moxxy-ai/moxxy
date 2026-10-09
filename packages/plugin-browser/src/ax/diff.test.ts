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

  it('reports a box that was ticked, though nothing else about it moved', () => {
    const box = (states?: AxNode['states']): AxNode => ({ uid: '5', role: 'checkbox', name: 'Odblokuj', ...(states ? { states } : {}), children: [] });
    const unticked = renderingOf(page(box()));
    const ticked = renderingOf(page(box(['checked'])));

    expect(diffRendering(unticked, ticked)).toEqual([expect.stringMatching(/^~ \[5\] checkbox: "Odblokuj" \[checked\]/)]);
    expect(diffRendering(ticked, ticked)).toEqual([]);
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

  it('sums up a large removal in one line instead of repeating every row that went', () => {
    // Typing "n8n" into Coolify's template filter hid ~297 cards, and the read
    // after it sent every one of them back as "- …": 156,263 characters,
    // +47,177 tokens, to say "the list got shorter". A uid that went away
    // cannot be acted on anyway; what the agent needs is that it went.
    const card = (i: number) =>
      node(String(100 + i), 'link', `Service ${i}: a self-hosted tool with a long description of what it does`);
    const cards = Array.from({ length: 300 }, (_, i) => card(i));
    const filtered = renderingOf(page(...cards));
    const after = renderingOf(page(...cards.slice(0, 3)));

    const out = diffRendering(filtered, after);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^- 297 elements went away/);
    expect(out[0]).toContain('Service 3');
    expect(out[0]?.length).toBeLessThan(300);
  });

  it('keeps what a changed row used to say short', () => {
    const long = `Opis ${'bardzo długi '.repeat(15)}`;
    const was = renderingOf(page(node('2', 'heading', long)));
    const now = renderingOf(page(node('2', 'heading', 'Krótko')));

    const [line] = diffRendering(was, now);

    expect(line).toContain('Krótko');
    expect(line).toMatch(/\(was: .{1,100}\)$/);
  });

  it('puts removals before additions, so a replacement reads as one thing', () => {
    const after = renderingOf(page(node('2', 'heading', 'Koty'), node('9', 'link', 'Nowa oferta')));

    const out = diffRendering(before, after);

    expect(out[0]).toMatch(/^- /);
    expect(out[1]).toMatch(/^\+ /);
  });
});
