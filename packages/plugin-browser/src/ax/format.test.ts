import { describe, expect, it } from 'vitest';
import { formatAxTree, MAX_LABEL_CHARS, MAX_TREE_DEPTH } from './format.js';
import type { AxNode } from './tree.js';

/**
 * The formatter is where the token budget is won or lost. A raw accessibility
 * tree of a real page is thousands of nodes, most of which carry no
 * information a model can act on — icon internals, unnamed layout wrappers,
 * whole SVG subtrees. These tests pin the four pruning rules that turn it into
 * something a model can read every step without draining the context window.
 */

let uid = 0;
function n(role: string, opts: { name?: string; value?: string; focused?: boolean; children?: AxNode[] } = {}): AxNode {
  return {
    uid: String(++uid),
    role,
    name: opts.name ?? '',
    ...(opts.value !== undefined ? { value: opts.value } : {}),
    ...(opts.focused ? { focused: true } : {}),
    children: opts.children ?? [],
  };
}

describe('formatAxTree — the row', () => {
  it('renders uid, role and accessible name', () => {
    expect(formatAxTree(n('button', { name: 'Zaloguj' }))).toBe('[1] button: "Zaloguj"');
  });

  it('omits the name when the node has none', () => {
    expect(formatAxTree(n('main'))).toBe('[2] main');
  });

  it('renders a field value so the model sees what is typed', () => {
    expect(formatAxTree(n('textbox', { name: 'E-mail', value: 'a@b.pl' }))).toBe(
      '[3] textbox: "E-mail" (value: "a@b.pl")',
    );
  });

  it('marks the focused node', () => {
    expect(formatAxTree(n('textbox', { name: 'Szukaj', focused: true }))).toBe(
      '[4] textbox: "Szukaj" [focused]',
    );
  });

  it('indents children by two spaces per level', () => {
    // uids come from the fixture helper's call order, which is inner-first —
    // assert the shape, not the numbers. Real uids are assigned pre-order by
    // buildAxTree and are covered in tree.test.ts.
    const tree = n('main', { children: [n('heading', { name: 'Tytuł' })] });
    const [parent, child] = formatAxTree(tree).split('\n');

    expect(parent).toMatch(/^\[\d+\] main$/);
    expect(child).toMatch(/^ {2}\[\d+\] heading: "Tytuł"$/);
  });
});

describe('formatAxTree — rule 1: depth cap', () => {
  it('collapses a subtree past the depth cap into one row with a descendant count', () => {
    // Build a chain deeper than the cap, each level named so nothing is flattened.
    let leaf = n('generic', { name: 'najgłębszy' });
    for (let i = 0; i < MAX_TREE_DEPTH + 4; i++) leaf = n('generic', { name: `poziom-${i}`, children: [leaf] });

    const out = formatAxTree(leaf);
    const lines = out.split('\n');

    expect(lines.length).toBeLessThanOrEqual(MAX_TREE_DEPTH + 1);
    expect(out).toMatch(/\.\.\. \(\d+ descendants\)/);
  });
});

describe('formatAxTree — rule 2: label truncation', () => {
  it('truncates a long accessible name', () => {
    const long = 'x'.repeat(MAX_LABEL_CHARS + 500);
    const out = formatAxTree(n('paragraph', { name: long }));

    expect(out.length).toBeLessThan(MAX_LABEL_CHARS + 80);
    expect(out).toContain('…');
  });

  it('truncates a long field value too', () => {
    const out = formatAxTree(n('textbox', { name: 'Opis', value: 'y'.repeat(MAX_LABEL_CHARS + 500) }));
    expect(out.length).toBeLessThan(MAX_LABEL_CHARS + 120);
  });
});

describe('formatAxTree — rule 3: decorative subtrees', () => {
  it('drops the internals of an SVG', () => {
    const svg = n('SvgRoot', {
      name: 'logo',
      children: [n('generic', { name: 'path-1' }), n('generic', { name: 'path-2' })],
    });

    const out = formatAxTree(svg);
    expect(out).toContain('SvgRoot');
    expect(out).not.toContain('path-1');
  });

  it('drops the internals of an image that has children', () => {
    const img = n('img', { name: 'Ikona', children: [n('generic', { name: 'wewnętrzny' })] });
    expect(formatAxTree(img)).not.toContain('wewnętrzny');
  });

  it('keeps a plain image row', () => {
    expect(formatAxTree(n('img', { name: 'Wykres' }))).toContain('img: "Wykres"');
  });
});

describe('formatAxTree — rule 4: wrapper flattening', () => {
  it('collapses an unnamed single-child container', () => {
    const tree = n('generic', { children: [n('button', { name: 'Kup' })] });
    const out = formatAxTree(tree);

    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('button: "Kup"');
  });

  it('collapses a chain of unnamed containers down to the meaningful node', () => {
    const tree = n('generic', {
      children: [n('none', { children: [n('generic', { children: [n('link', { name: 'Dalej' })] })] })],
    });

    expect(formatAxTree(tree).split('\n')).toHaveLength(1);
  });

  it('keeps a container that carries a name', () => {
    const tree = n('generic', { name: 'Pasek', children: [n('button', { name: 'OK' })] });
    expect(formatAxTree(tree).split('\n')).toHaveLength(2);
  });

  it('keeps a container with more than one child', () => {
    const tree = n('generic', { children: [n('button', { name: 'A' }), n('button', { name: 'B' })] });
    expect(formatAxTree(tree).split('\n')).toHaveLength(3);
  });
});

describe('formatAxTree — the whole point', () => {
  it('shrinks an icon-heavy page to the rows that carry meaning', () => {
    // 60 icons, each an SVG with 20 internal paths, wrapped three divs deep —
    // the shape every real site has and the shape that used to cost thousands
    // of tokens per step.
    const icons = Array.from({ length: 60 }, (_, i) =>
      n('generic', {
        children: [
          n('generic', {
            children: [
              n('SvgRoot', {
                name: `ikona-${i}`,
                children: Array.from({ length: 20 }, (_, j) => n('generic', { name: `p${j}` })),
              }),
            ],
          }),
        ],
      }),
    );
    const page = n('RootWebArea', { name: 'Sklep', children: [...icons, n('button', { name: 'Do kasy' })] });

    const out = formatAxTree(page);

    // 1 root + 60 collapsed icons + 1 button — the 1200 path nodes are gone.
    expect(out.split('\n')).toHaveLength(62);
    expect(out).toContain('Do kasy');
    expect(out).not.toContain('p0');
  });
});
