import { describe, expect, it } from 'vitest';
import { buildAxTree, type AxNodeRaw, newUidMemory } from './tree.js';

/**
 * The AX tree is what the model reads instead of a screenshot, so its shape is
 * a contract: every interactive node must carry a `uid` the model can act on,
 * and that uid must survive the walk unchanged. These tests run on raw
 * `Accessibility.getFullAXTree` payloads (the CDP shape) with no browser.
 */

/** Build a CDP-shaped node without repeating the wrapper objects each time. */
function node(
  nodeId: string,
  role: string,
  opts: {
    name?: string;
    value?: string;
    children?: string[];
    ignored?: boolean;
    backendDOMNodeId?: number;
    focused?: boolean;
  } = {},
): AxNodeRaw {
  return {
    nodeId,
    role: { value: role },
    ...(opts.name !== undefined ? { name: { value: opts.name } } : {}),
    ...(opts.value !== undefined ? { value: { value: opts.value } } : {}),
    ...(opts.children ? { childIds: opts.children } : {}),
    ...(opts.ignored ? { ignored: true } : {}),
    ...(opts.backendDOMNodeId !== undefined ? { backendDOMNodeId: opts.backendDOMNodeId } : {}),
    ...(opts.focused ? { properties: [{ name: 'focused', value: { value: true } }] } : {}),
  };
}

describe('buildAxTree', () => {
  it('returns null for an empty node list', () => {
    expect(buildAxTree([])).toBeNull();
  });

  it('assigns sequential uids depth-first from the root', () => {
    const tree = buildAxTree([
      node('1', 'RootWebArea', { name: 'Doc', children: ['2', '4'] }),
      node('2', 'banner', { children: ['3'] }),
      node('3', 'button', { name: 'Zaloguj' }),
      node('4', 'main'),
    ]);

    expect(tree).not.toBeNull();
    expect(tree!.uid).toBe('1');
    expect(tree!.children[0]!.uid).toBe('2');
    expect(tree!.children[0]!.children[0]!.uid).toBe('3');
    expect(tree!.children[1]!.uid).toBe('4');
  });

  it('carries role, name, value and backend node id through', () => {
    const tree = buildAxTree([
      node('1', 'RootWebArea', { children: ['2'] }),
      node('2', 'textbox', { name: 'E-mail', value: 'a@b.pl', backendDOMNodeId: 42 }),
    ]);

    const field = tree!.children[0]!;
    expect(field.role).toBe('textbox');
    expect(field.name).toBe('E-mail');
    expect(field.value).toBe('a@b.pl');
    expect(field.backendNodeId).toBe(42);
  });

  it('marks the focused node so the model knows where the caret is', () => {
    const tree = buildAxTree([
      node('1', 'RootWebArea', { children: ['2'] }),
      node('2', 'textbox', { name: 'Szukaj', focused: true }),
    ]);

    expect(tree!.children[0]!.focused).toBe(true);
  });

  it('splices out an ignored node but keeps its children', () => {
    // A presentational wrapper must not swallow the button underneath it.
    const tree = buildAxTree([
      node('1', 'RootWebArea', { children: ['2'] }),
      node('2', 'generic', { ignored: true, children: ['3'] }),
      node('3', 'button', { name: 'Dalej' }),
    ]);

    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0]!.role).toBe('button');
    expect(tree!.children[0]!.name).toBe('Dalej');
  });

  it('survives a childId that does not resolve', () => {
    const tree = buildAxTree([
      node('1', 'RootWebArea', { children: ['2', 'ghost'] }),
      node('2', 'button', { name: 'OK' }),
    ]);

    expect(tree!.children).toHaveLength(1);
  });

  it('does not loop forever on a cyclic childId graph', () => {
    // A malformed/hostile payload must degrade, not hang the turn.
    const tree = buildAxTree([
      node('1', 'RootWebArea', { children: ['2'] }),
      node('2', 'generic', { children: ['1'] }),
    ]);

    expect(tree).not.toBeNull();
    expect(tree!.children[0]!.children).toHaveLength(0);
  });

  it('defaults a missing role to unknown and a missing name to empty', () => {
    const tree = buildAxTree([{ nodeId: '1' }]);

    expect(tree!.role).toBe('unknown');
    expect(tree!.name).toBe('');
  });
});

describe('buildAxTree — uid index', () => {
  it('exposes a uid to backend-node lookup for the action layer', () => {
    const tree = buildAxTree([
      node('1', 'RootWebArea', { children: ['2'] }),
      node('2', 'button', { name: 'Kup', backendDOMNodeId: 77 }),
    ]);

    expect(tree!.index.get('2')?.backendNodeId).toBe(77);
    expect(tree!.index.get('1')?.role).toBe('RootWebArea');
  });
});

describe('buildAxTree — uids that survive the page changing', () => {
  /**
   * uids used to be a counter in document order, so inserting one element near
   * the top renumbered everything below it. Measured on a Wikipedia article:
   * one added element left 1% of lines matching, which makes a diff worthless —
   * everything "changed".
   *
   * Chromium's own accessibility node ids are stable: after an insertion, all
   * 17,644 nodes with a DOM node kept theirs and none moved. Keying off those
   * and remembering the mapping gives a uid that means the same element read
   * after read, while staying short enough to be worth sending.
   */
  const raw = (nodeId: string, role: string, name: string, childIds?: string[]): AxNodeRaw =>
    ({ nodeId, role: { value: role }, name: { value: name }, ...(childIds ? { childIds } : {}) }) as AxNodeRaw;

  const PAGE: AxNodeRaw[] = [
    raw('n10', 'RootWebArea', 'Sklep', ['n20', 'n30']),
    raw('n20', 'heading', 'Nagłówek'),
    raw('n30', 'button', 'Kup'),
  ];

  it('gives the same element the same uid on a second read', () => {
    const memory = newUidMemory();

    const first = buildAxTree(PAGE, memory);
    const second = buildAxTree(PAGE, memory);

    expect([...first!.index.keys()].sort()).toEqual([...second!.index.keys()].sort());
    for (const name of ['Sklep', 'Nagłówek', 'Kup']) {
      const before = [...first!.index.values()].find((n) => n.name === name)?.uid;
      const after = [...second!.index.values()].find((n) => n.name === name)?.uid;
      expect(after, `${name} changed uid between reads`).toBe(before);
    }
  });

  it('leaves the rest alone when something appears above them', () => {
    const memory = newUidMemory();
    const before = buildAxTree(PAGE, memory)!;
    const uidOfButton = [...before.index.values()].find((n) => n.name === 'Kup')!.uid;

    const after = buildAxTree(
      [raw('n10', 'RootWebArea', 'Sklep', ['n5', 'n20', 'n30']), raw('n5', 'button', 'Nowy'), PAGE[1]!, PAGE[2]!],
      memory,
    )!;

    expect([...after.index.values()].find((n) => n.name === 'Kup')?.uid).toBe(uidOfButton);
    expect([...after.index.values()].find((n) => n.name === 'Nowy')?.uid).toBe('4');
  });

  /** uid of the node with this name, however the index happens to be ordered. */
  const uidOf = (tree: AxTree, name: string): string | undefined =>
    [...tree.index.values()].find((n) => n.name === name)?.uid;

  it('starts over for a page it has never seen', () => {
    const tree = buildAxTree(PAGE, newUidMemory())!;

    expect(uidOf(tree, 'Sklep')).toBe('1');
    expect(uidOf(tree, 'Nagłówek')).toBe('2');
    expect(uidOf(tree, 'Kup')).toBe('3');
  });

  it('numbers from scratch when no memory is offered', () => {
    // The sidecar and every existing caller keep working unchanged.
    const a = buildAxTree(PAGE)!;
    const b = buildAxTree(PAGE)!;

    expect(uidOf(a, 'Kup')).toBe('3');
    expect(uidOf(b, 'Kup')).toBe('3');
  });
});

describe('buildAxTree — nodes read from a frame', () => {
  /**
   * A frame from another site is a separate document with its own DOM, read
   * through its own session. Its nodes carry that session so an action on one
   * of them goes to the frame, not to the page around it.
   */
  it('keeps the frame a node came from', () => {
    const tree = buildAxTree([
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Strona' }, childIds: ['f:1'] },
      { nodeId: 'f:1', role: { value: 'link' }, name: { value: 'Learn more' }, backendDOMNodeId: 5, frame: 'S1' },
    ]);

    const link = tree?.children[0];
    expect(link).toMatchObject({ role: 'link', name: 'Learn more', backendNodeId: 5, frame: 'S1' });
    expect(tree).not.toHaveProperty('frame');
  });
});

describe('buildAxTree — work the page says is still under way', () => {
  const root = { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] };

  it('marks what the page declares busy', () => {
    // Chromium reports aria-busy="true" as the number 1.
    const tree = buildAxTree([
      root,
      { nodeId: '2', role: { value: 'region' }, name: { value: 'Logs' }, properties: [{ name: 'busy', value: { value: 1 } }] },
    ]);

    expect(tree?.children[0]?.inProgress).toBe(true);
  });

  it('leaves a document that is still loading alone: that is the page, not work it reports', () => {
    // n8n's sign-in page never finished loading; its root stayed busy, and the
    // agent was told to wait for "[1] RootWebArea [in progress]".
    const busy = [{ name: 'busy', value: { value: 1 } }];
    const tree = buildAxTree([
      { ...root, properties: busy, childIds: ['2'] },
      { nodeId: '2', role: { value: 'Iframe' }, childIds: ['3'] },
      { nodeId: '3', role: { value: 'WebArea' }, properties: busy },
    ]);

    expect(tree?.inProgress).toBeUndefined();
    expect(tree?.children[0]?.children[0]?.inProgress).toBeUndefined();
  });

  it('marks a progress bar that shows no amount — the spinner kind', () => {
    const tree = buildAxTree([root, { nodeId: '2', role: { value: 'progressbar' }, name: { value: 'Deploying' } }]);

    expect(tree?.children[0]?.inProgress).toBe(true);
  });

  it('leaves a progress bar showing an amount alone: it is as likely a gauge as a task', () => {
    const tree = buildAxTree([
      root,
      {
        nodeId: '2',
        role: { value: 'progressbar' },
        name: { value: 'Disk usage' },
        // Chromium carries the amount as the node's value, not as a property.
        value: { value: 40 },
      },
    ]);

    expect(tree?.children[0]?.inProgress).toBeUndefined();
  });
});

describe('buildAxTree — a control the page gives no name', () => {
  const root = { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] };

  it('carries what its markup says, and leaves a named control as it is', () => {
    const tree = buildAxTree(
      [
        root,
        { nodeId: '2', role: { value: 'button' }, name: { value: '' }, backendDOMNodeId: 20 },
        { nodeId: '3', role: { value: 'button' }, name: { value: 'Restart' }, backendDOMNodeId: 30 },
      ],
      undefined,
      new Map([
        [20, '@click="modalOpen=false"'],
        [30, 'wire:click="restart"'],
      ]),
    );

    expect(tree?.children[0]?.hint).toBe('@click="modalOpen=false"');
    expect(tree?.children[1]?.hint).toBeUndefined();
  });
});
