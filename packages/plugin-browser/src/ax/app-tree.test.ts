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
