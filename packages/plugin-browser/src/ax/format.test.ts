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
function n(
  role: string,
  opts: { name?: string; value?: string; focused?: boolean; inProgress?: boolean; children?: AxNode[] } = {},
): AxNode {
  return {
    uid: String(++uid),
    role,
    name: opts.name ?? '',
    ...(opts.value !== undefined ? { value: opts.value } : {}),
    ...(opts.focused ? { focused: true } : {}),
    ...(opts.inProgress ? { inProgress: true } : {}),
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

  it('says what the markup says about a control with no name', () => {
    const icon: AxNode = { uid: '90', role: 'button', name: '', hint: '@click="modalOpen=false"', children: [] };
    expect(formatAxTree(icon)).toBe('[90] button (no name; markup: @click="modalOpen=false")');
  });

  it('marks the focused node', () => {
    expect(formatAxTree(n('textbox', { name: 'Szukaj', focused: true }))).toBe(
      '[4] textbox: "Szukaj" [focused]',
    );
  });

  it('marks what the page says the element is in, after the focus', () => {
    const box: AxNode = { uid: '5', role: 'checkbox', name: 'Odblokuj', focused: true, states: ['checked'], children: [] };
    const off: AxNode = { uid: '8', role: 'button', name: 'Pokaż kod', states: ['disabled'], children: [] };
    const half: AxNode = { uid: '9', role: 'checkbox', name: 'Wszystkie', states: ['mixed'], children: [] };
    const menu: AxNode = { uid: '10', role: 'button', name: 'Filtry', states: ['expanded'], inProgress: true, children: [] };

    expect(formatAxTree(box)).toBe('[5] checkbox: "Odblokuj" [focused] [checked]');
    expect(formatAxTree(off)).toBe('[8] button: "Pokaż kod" [disabled]');
    expect(formatAxTree(half)).toBe('[9] checkbox: "Wszystkie" [partly checked]');
    expect(formatAxTree(menu)).toBe('[10] button: "Filtry" [expanded] [in progress]');
  });

  it('says a field is read-only, so the way to unlock it is looked for before typing', () => {
    const field: AxNode = { uid: '46', role: 'textbox', name: 'Nazwa wyświetlana', value: 'kamil123', states: ['read-only'], children: [] };

    expect(formatAxTree(field)).toBe('[46] textbox: "Nazwa wyświetlana" (value: "kamil123") [read-only]');
  });

  it('says a toggle is off, so it is not taken for a plain button and pressed again', () => {
    const toggle: AxNode = { uid: '32', role: 'button', name: 'Profil publiczny', states: ['not pressed'], children: [] };

    expect(formatAxTree(toggle)).toBe('[32] button: "Profil publiczny" [not pressed]');
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

/**
 * Seen live on books.toscrape.com in the narrow Browser pane: every book's
 * price sat in a paragraph at the cap, which collapsed to `paragraph ... (2
 * descendants)`. The model saw the titles and none of the prices, and named
 * the first book as the cheapest.
 */
describe('formatAxTree — rule 1: what a collapsed row still says', () => {
  function deepPrice(): AxNode {
    let top = n('paragraph', { children: [n('StaticText', { name: '£53.74', children: [n('InlineTextBox', { name: '£53.74' })] })] });
    for (let i = 0; i < MAX_TREE_DEPTH; i++) top = n('article', { name: `poziom-${i}`, children: [top, n('link', { name: `obok-${i}` })] });
    return top;
  }

  it('keeps the text under an unnamed row it collapses, once', () => {
    const out = formatAxTree(deepPrice());
    const collapsed = out.split('\n').find((line) => line.includes('descendants')) ?? '';

    expect(collapsed).toContain('paragraph');
    expect(collapsed).toContain('"£53.74"');
    expect(collapsed.match(/£53\.74/g)).toHaveLength(1);
  });

  it('cuts that text like any other label', () => {
    let top = n('paragraph', { children: [n('StaticText', { name: 'z'.repeat(MAX_LABEL_CHARS * 3) })] });
    for (let i = 0; i < MAX_TREE_DEPTH; i++) top = n('article', { name: `p-${i}`, children: [top, n('link', { name: `o-${i}` })] });

    const collapsed = formatAxTree(top).split('\n').find((line) => line.includes('descendants')) ?? '';
    expect(collapsed.length).toBeLessThan(MAX_LABEL_CHARS + 120);
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

describe('formatAxTree — work in progress', () => {
  it('says on the row that the element is still working', () => {
    expect(formatAxTree(n('progressbar', { name: 'Deploying', inProgress: true }))).toMatch(
      /^\[\d+\] progressbar: "Deploying" \[in progress\]$/,
    );
  });
});

describe('formatAxTree — row context', () => {
  it('does not use a decorative subtree label instead of the visible row label', () => {
    const page = n('listitem', { children: [
      n('img', { children: [n('LabelText', { children: [n('StaticText', { name: 'Decoy' })] })] }),
      n('LabelText', { children: [n('StaticText', { name: 'Actual task' })] }),
      n('button', { name: 'Delete' }),
    ] });
    const button = formatAxTree(page).split('\n').find(line => line.includes('button: "Delete"'));
    expect(button).toContain('row "Actual task"');
    expect(button).not.toContain('Decoy');
  });

  it('keeps nested row context out of the outer row and unrelated controls', () => {
    const page = n('RootWebArea', { children: [
      n('listitem', { children: [
        n('button', { name: 'Outer action' }),
        n('listitem', { children: [
          n('LabelText', { children: [n('StaticText', { name: 'Inner task' })] }),
          n('button', { name: 'Inner action' }),
        ] }),
      ] }),
      n('button', { name: 'Unrelated action' }),
    ] });
    const buttons = formatAxTree(page).split('\n').filter(line => line.includes('button:'));
    expect(buttons[0]).not.toContain('(row');
    expect(buttons[1]).toContain('row "Inner task"');
    expect(buttons[2]).not.toContain('(row');
  });
});
