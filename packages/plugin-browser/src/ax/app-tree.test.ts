import { appTreeSchema, byName, formatTree } from '@moxxy/jev';
import { describe, expect, it } from 'vitest';
import { appTreeOf } from './app-tree.js';
import type { AxNode } from './tree.js';

const node = (uid: string, role: string, name = '', children: AxNode[] = [], extra: Partial<AxNode> = {}): AxNode =>
  ({ uid, role, name, children, ...extra }) as AxNode;

const page = node('1', 'RootWebArea', 'Shop', [
  node('2', 'banner', '', [
    node('3', 'link', 'Home'),
    node('4', 'search', '', [node('5', 'searchbox', 'Search books', [], { focused: true })]),
  ]),
  node('6', 'main', '', [
    node('7', 'heading', 'Results'),
    node('8', 'list', '', [
      node('9', 'listitem', '', [node('10', 'link', 'A Light in the Attic'), node('11', 'button', 'Add to basket')]),
      node('12', 'listitem', '', [node('13', 'link', 'Tipping the Velvet'), node('14', 'button', 'Add to basket')]),
    ]),
    node('15', 'textbox', 'Password', [], { value: 'hunter2' }),
    node('16', 'combobox', 'Sort by', [node('17', 'option', 'Price', [], { value: undefined })], { value: 'Relevance' }),
  ]),
]);

describe('appTreeOf', () => {
  const tree = appTreeOf(page, { app: 'books.toscrape.com', window: 'Shop' });

  it('lists the elements one can act on, each under the uid the other tools use', () => {
    expect(appTreeSchema.safeParse(tree).success).toBe(true);
    expect(tree.app).toBe('books.toscrape.com');
    expect(tree.window).toBe('Shop');
    expect(tree.elements.map((element) => [element.index, element.role, element.title])).toEqual([
      [3, 'link', 'Home'],
      [5, 'searchbox', 'Search books'],
      [10, 'link', 'A Light in the Attic'],
      [11, 'button', 'Add to basket'],
      [13, 'link', 'Tipping the Velvet'],
      [14, 'button', 'Add to basket'],
      [15, 'textbox', 'Password'],
      [16, 'combobox', 'Sort by'],
      [17, 'option', 'Price'],
    ]);
  });

  it('keeps what contains what, so an option belongs to its list', () => {
    const depth = Object.fromEntries(tree.elements.map((element) => [element.index, element.depth]));
    expect(depth[16]).toBe(1);
    expect(depth[17]).toBe(2);
  });

  it('gives a field one types into a value, even an empty one, and never a secret', () => {
    const byIndex = new Map(tree.elements.map((element) => [element.index, element]));
    expect(byIndex.get(5)?.value).toBe('');
    expect(byIndex.get(5)?.states).toEqual(['focused']);
    expect(byIndex.get(15)).toMatchObject({ secure: true });
    expect(byIndex.get(15)?.value).toBeUndefined();
    expect(formatTree(tree)).not.toContain('hunter2');
    expect(byIndex.get(3)?.value).toBeUndefined();
  });

  it('keys an element by its place among its kind, so the same element keeps its key on the next load', () => {
    const again = appTreeOf(
      node('100', 'RootWebArea', 'Shop', [node('101', 'link', 'Home'), node('102', 'link', 'Basket')]),
      { app: 'books.toscrape.com' },
    );
    const keys = new Set(tree.elements.map((element) => element.key));
    expect(keys.size).toBe(tree.elements.length);
    expect(again.elements[0]?.key).toBe(tree.elements[0]?.key);
  });

  it('lets a name find its element without asking Jev', () => {
    expect(byName(tree, { do: 'type', target: 'Search books field' })?.index).toBe(5);
    expect(byName(tree, { do: 'click', target: 'Add to basket' })).toBeUndefined();
  });

  it('stops at what the schema takes and says so', () => {
    const many = node('1', 'RootWebArea', '', Array.from({ length: 5_010 }, (_, at) => node(String(at + 2), 'link', `L${at}`)));
    const capped = appTreeOf(many, { app: 'x.com' });
    expect(capped.elements).toHaveLength(5_000);
    expect(capped.truncated).toBe(true);
    expect(appTreeSchema.safeParse(capped).success).toBe(true);
  });
});

describe('appTreeOf — what a page answers clicks on without saying so', () => {
  /**
   * Coolify's catalogue of services is a grid of cards, each a `div` with a click
   * handler and no role. Read by role alone the grid had nothing to click: a run
   * asked for the "N8N" card twice and was told the closest thing was the
   * "Coolify" logo. The browser knows which nodes answer a click; those count,
   * named by the text they show.
   */
  const text = (uid: string, line: string) => node(uid, 'StaticText', line);
  const card = (uid: string, backendNodeId: number, ...lines: string[]) =>
    node(uid, 'generic', '', lines.map((line, at) => text(`${uid}${at}`, line)), { backendNodeId });
  const catalogue = node('1', 'RootWebArea', 'New resource', [
    node('2', 'main', '', [
      card('20', 200, 'N8N', 'n8n is an extendable workflow automation tool.'),
      card('21', 201, 'N8N With Postgresql', 'n8n is an extendable workflow automation tool.'),
      card('22', 202, 'Cap Captcha', 'The self-hosted CAPTCHA for the modern web.'),
      card('23', 203, 'Not clickable', 'Just prose.'),
      card('24', 204, 'x'.repeat(300)),
    ]),
  ]);
  const clickable = new Set([200, 201, 202, 204]);
  const tree = appTreeOf(catalogue, { app: 'mgmt.warocket.shop' }, { clickable });

  it('lists a card that answers clicks, titled by its first line and described by the rest', () => {
    expect(appTreeSchema.safeParse(tree).success).toBe(true);
    expect(tree.elements.map((element) => [element.index, element.role, element.title, element.description])).toEqual([
      [20, 'generic', 'N8N', 'n8n is an extendable workflow automation tool.'],
      [21, 'generic', 'N8N With Postgresql', 'n8n is an extendable workflow automation tool.'],
      [22, 'generic', 'Cap Captcha', 'The self-hosted CAPTCHA for the modern web.'],
    ]);
  });

  it('lets the card be found by the name it shows', () => {
    expect(byName(tree, { do: 'click', target: 'N8N' })?.index).toBe(20);
  });

  it('leaves out what does not answer clicks, and a "card" that is a whole page of text', () => {
    const indexes = tree.elements.map((element) => element.index);
    expect(indexes).not.toContain(23);
    expect(indexes).not.toContain(24);
  });

  it('lists nothing extra when it is not told what answers clicks', () => {
    expect(appTreeOf(catalogue, { app: 'mgmt.warocket.shop' }).elements).toEqual([]);
  });
});

describe('appTreeOf — a field is called what its label says', () => {
  /**
   * Coolify's service settings put a `<label>` above each field without tying
   * the two together, so the fields reach the tree with no name ("Description")
   * or with their placeholder for one ("https://app.coolify.io" for Domains).
   * A run asked to type into "Domains" was given the unnamed field and typed the
   * domain into Description. A label that stands right before a field names it.
   */
  const label = (uid: string, text: string) => node(uid, 'LabelText', '', [node(`${uid}0`, 'StaticText', text)]);
  const form = node('1', 'RootWebArea', 'Configuration', [
    node('2', 'generic', '', [label('30', 'Description'), node('31', 'textbox', '', [], { value: '' })]),
    node('3', 'generic', '', [
      label('40', 'Domains'),
      node('41', 'textbox', 'https://app.coolify.io', [], { value: 'http://n8n.example.sslip.io:5678' }),
    ]),
    node('5', 'generic', '', [label('50', 'Image'), node('51', 'button', 'Pick'), node('52', 'textbox', '', [], { value: 'n8nio/n8n' })]),
  ]);
  const tree = appTreeOf(form, { app: 'mgmt.warocket.shop' });
  const byIndex = new Map(tree.elements.map((element) => [element.index, element]));

  it('names a field by the label right before it, and keeps what it was called as its description', () => {
    expect(byIndex.get(31)).toMatchObject({ role: 'textbox', title: 'Description', value: '' });
    expect(byIndex.get(41)).toMatchObject({ title: 'Domains', description: 'https://app.coolify.io' });
  });

  it('lets a run find the field by its label', () => {
    expect(byName(tree, { do: 'type', target: 'Domains textbox' })?.index).toBe(41);
  });

  it('does not carry a label past another control', () => {
    expect(byIndex.get(51)).toMatchObject({ title: 'Pick' });
    expect(byIndex.get(52)?.title).toBeUndefined();
  });
});

describe('appTreeOf — a control with nothing to call it by is not an option', () => {
  /**
   * A run asked for "Redeploy" was given a button with no name at all and pressed
   * it: Jev cannot tell one nameless button from another, so offering them only
   * invites a blind guess. A field stays, since its value says what it holds.
   */
  it('leaves out a button with no name, and keeps the named ones and the fields', () => {
    const tree = appTreeOf(
      node('1', 'RootWebArea', 'Service', [node('2', 'button', ''), node('3', 'button', 'Restart'), node('4', 'textbox', '', [], { value: 'x' })]),
      { app: 'mgmt.warocket.shop' },
    );
    expect(tree.elements.map((element) => element.index)).toEqual([3, 4]);
  });
});
