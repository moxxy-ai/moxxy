import { describe, expect, it } from 'vitest';
import { formatSnapshot, redactSecretValues, UNTRUSTED_NOTE } from './snapshot.js';
import type { AxNode } from './tree.js';

let uid = 0;
function n(role: string, opts: { name?: string; value?: string; children?: AxNode[] } = {}): AxNode {
  return {
    uid: String(++uid),
    role,
    name: opts.name ?? '',
    ...(opts.value !== undefined ? { value: opts.value } : {}),
    children: opts.children ?? [],
  };
}

describe('redactSecretValues', () => {
  it('removes the value of a field whose label names a password', () => {
    const tree = n('form', { children: [n('textbox', { name: 'Hasło', value: 'tajne123' })] });
    const safe = redactSecretValues(tree);

    expect(JSON.stringify(safe)).not.toContain('tajne123');
    expect(safe.children[0]!.value).toBe('[redacted]');
  });

  it.each(['Password', 'hasło', 'Passwort', 'OTP code', 'Kod SMS', 'PIN', 'CVV', 'Secret key'])(
    'redacts a field labelled %s',
    (label) => {
      const tree = n('textbox', { name: label, value: 'wartość' });
      expect(redactSecretValues(tree).value).toBe('[redacted]');
    },
  );

  it('leaves an ordinary field alone', () => {
    const tree = n('textbox', { name: 'E-mail', value: 'a@b.pl' });
    expect(redactSecretValues(tree).value).toBe('a@b.pl');
  });

  it('redacts a value that is already rendered as bullets', () => {
    // Chrome exposes masked inputs as bullets; the label may be missing
    // entirely, so the value shape is the only signal left.
    const tree = n('textbox', { name: '', value: '••••••••' });
    expect(redactSecretValues(tree).value).toBe('[redacted]');
  });

  it('keeps the name so the model still knows the field is there', () => {
    const tree = n('textbox', { name: 'Hasło', value: 'x' });
    expect(redactSecretValues(tree).name).toBe('Hasło');
  });

  it('does not mutate the input tree', () => {
    const tree = n('textbox', { name: 'Hasło', value: 'tajne' });
    redactSecretValues(tree);
    expect(tree.value).toBe('tajne');
  });
});

describe('formatSnapshot', () => {
  const tabs = [
    { tabId: 't1', url: 'https://canva.com/design', title: 'Projekt', active: true },
    { tabId: 't2', url: 'https://mail.google.com', title: 'Poczta', active: false },
  ];

  it('reports the page the agent is looking at', () => {
    const out = formatSnapshot({ tree: n('RootWebArea', { name: 'Projekt' }), url: 'https://canva.com/design', title: 'Projekt', tabs });

    expect(out).toContain('https://canva.com/design');
    expect(out).toContain('Projekt');
  });

  it('lists every open tab and marks the active one', () => {
    const out = formatSnapshot({ tree: null, url: '', title: '', tabs });

    expect(out).toContain('t1');
    expect(out).toContain('t2');
    expect(out).toContain('(current)');
    // The marker belongs to the active tab, not the other one.
    const currentLine = out.split('\n').find((l) => l.includes('(current)'));
    expect(currentLine).toContain('t1');
  });

  it('frames page content as untrusted data before the tree', () => {
    const out = formatSnapshot({ tree: n('RootWebArea', { name: 'X' }), url: 'u', title: 't', tabs });

    expect(out).toContain(UNTRUSTED_NOTE);
    expect(out.indexOf(UNTRUSTED_NOTE)).toBeLessThan(out.indexOf('RootWebArea'));
  });

  it('redacts secrets on the way out', () => {
    const tree = n('form', { children: [n('textbox', { name: 'Hasło', value: 'nieujawniac' })] });
    expect(formatSnapshot({ tree, url: 'u', title: 't', tabs })).not.toContain('nieujawniac');
  });

  it('still reports where it is when the tree is empty', () => {
    const out = formatSnapshot({ tree: null, url: 'about:blank', title: '', tabs });

    expect(out).toContain('about:blank');
    expect(out).toContain('t1');
  });
});

describe('formatSnapshot — reusing an already-rendered tree', () => {
  /**
   * The host has to render the tree to know whether the page changed since the
   * last read. Rendering it a second time to build the envelope would double
   * the cost of every snapshot — 600ms on a page the size of a Wikipedia
   * article — so it can hand the rendering back in.
   */
  it('uses the body it was given instead of rendering again', () => {
    const tree = { uid: '1', role: 'RootWebArea', name: 'Sklep', children: [] };

    const out = formatSnapshot({
      tree,
      url: 'https://sklep.pl',
      title: 'Sklep',
      tabs: [],
      body: '[1] RootWebArea: "juz-policzone"',
    });

    expect(out).toContain('juz-policzone');
    expect(out).not.toContain('Sklep"');
  });

  it('renders the tree itself when nothing was handed in', () => {
    const tree = { uid: '1', role: 'RootWebArea', name: 'Sklep', children: [] };

    const out = formatSnapshot({ tree, url: 'https://sklep.pl', title: 'Sklep', tabs: [] });

    expect(out).toContain('RootWebArea');
    expect(out).toContain('Sklep');
  });
});

describe('formatSnapshot — a page that is waiting on a person', () => {
  /**
   * The envelope already answers "which page am I on" and "is this trustworthy"
   * unprompted. A wall is the third thing worth saying every time: without it
   * the model has to infer from a pile of buttons that the page has stopped
   * being readable, and the cheapest wrong guess is pressing "Accept all".
   */
  const consentPage = {
    uid: '1',
    role: 'RootWebArea',
    name: 'Zanim przejdziesz do Google',
    children: [{ uid: '2', role: 'button', name: 'Zaakceptuj wszystko', children: [] }],
  };

  it('says so above the page content, not buried in it', () => {
    const out = formatSnapshot({
      tree: consentPage,
      url: 'https://www.google.com/search?q=koty',
      title: 'Zanim przejdziesz do Google',
      tabs: [],
    });

    expect(out).toContain('browser_await_human');
    expect(out.indexOf('browser_await_human')).toBeLessThan(out.indexOf('### Snapshot'));
  });

  it('stays quiet on a page that is simply a page', () => {
    const out = formatSnapshot({
      tree: { uid: '1', role: 'RootWebArea', name: 'Sklep', children: [] },
      url: 'https://sklep.pl',
      title: 'Sklep',
      tabs: [],
    });

    expect(out).not.toContain('browser_await_human');
  });
});
