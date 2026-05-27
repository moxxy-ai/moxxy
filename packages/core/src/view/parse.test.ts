import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_TAGS, type ViewNode } from '@moxxy/sdk';
import { parseView, validateDoc } from './parse.js';

const parse = (src: string) => parseView(src, DEFAULT_VIEW_TAGS);

function find(node: ViewNode, tag: string): Extract<ViewNode, { kind: 'element' }> | null {
  if (node.kind === 'element') {
    if (node.tag === tag) return node;
    for (const c of node.children) {
      const hit = find(c, tag);
      if (hit) return hit;
    }
  }
  return null;
}

function findAll(node: ViewNode, tag: string): Array<Extract<ViewNode, { kind: 'element' }>> {
  const out: Array<Extract<ViewNode, { kind: 'element' }>> = [];
  const walk = (n: ViewNode) => {
    if (n.kind !== 'element') return;
    if (n.tag === tag) out.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

describe('parseView — valid', () => {
  it('parses a form, extracts the title and the form action + fields', () => {
    const res = parse(`
      <view title="Find flights">
        <form action="search_flights" submit="Search">
          <row gap="md">
            <input name="from" label="From" required />
            <input name="to" label="To" required />
          </row>
          <input name="depart" type="date" label="Depart" />
          <select name="cabin" value="economy">
            <option value="economy">Economy</option>
            <option value="business">Business</option>
          </select>
        </form>
      </view>
    `);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.title).toBe('Find flights');
    const form = find(res.doc.root, 'form')!;
    expect(form.action?.name).toBe('search_flights');
    expect(form.action?.fields).toEqual(['from', 'to', 'depart', 'cabin']);
    // submit is a recognized attribute, coerced onto props
    expect(form.props.submit).toBe('Search');
  });

  it('expands results into a card stack with open buttons', () => {
    const res = parse(`
      <view title="2 results">
        <results>
          <result id="UA42" title="United SFO→JFK" subtitle="08:10 → 16:45" badge="$312" />
          <result id="B6-11" title="JetBlue SFO→JFK" subtitle="11:30 → 20:05" badge="$289" />
        </results>
      </view>
    `);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No component tags survive expansion.
    expect(find(res.doc.root, 'results')).toBeNull();
    expect(find(res.doc.root, 'result')).toBeNull();
    const cards = findAll(res.doc.root, 'card');
    expect(cards).toHaveLength(2);
    const buttons = findAll(res.doc.root, 'button');
    // No explicit action/to → defaults to open:<id>.
    expect(buttons.map((b) => b.action?.name)).toEqual(['open:UA42', 'open:B6-11']);
  });

  it('coerces number, boolean and enum attributes', () => {
    const res = parse(`<view><grid cols="3" gap="lg"><input name="q" required /></grid></view>`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const grid = find(res.doc.root, 'grid')!;
    expect(grid.props.cols).toBe(3);
    expect(grid.props.gap).toBe('lg');
    const input = find(res.doc.root, 'input')!;
    expect(input.props.required).toBe(true);
  });

  it('carries explicit button fields from a csv', () => {
    const res = parse(`<view><button action="go" label="Go" fields="a, b ,c" /></view>`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(find(res.doc.root, 'button')!.action?.fields).toEqual(['a', 'b', 'c']);
  });
});

describe('parseView — rejected (security + allow-list)', () => {
  const expectError = (src: string, match: RegExp) => {
    const res = parse(src);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => match.test(e.message))).toBe(true);
  };

  it('rejects unknown tags (incl. <script>)', () => {
    expectError(`<view><script>alert(1)</script></view>`, /unknown tag <script>/);
    expectError(`<view><marquee>hi</marquee></view>`, /unknown tag <marquee>/);
  });

  it('rejects unknown attributes', () => {
    expectError(`<view><text style="color:red">x</text></view>`, /unknown attribute "style"/);
  });

  it('rejects on* handler attributes', () => {
    expectError(`<view><button action="x" label="y" onclick="evil()" /></view>`, /forbidden attribute "onclick"/);
  });

  it('rejects disallowed URL schemes on href/src', () => {
    expectError(`<view><link href="javascript:alert(1)">x</link></view>`, /disallowed URL scheme/);
    expectError(`<view><image src="javascript:alert(1)" /></view>`, /disallowed URL scheme/);
  });

  it('allows https and relative URLs', () => {
    expect(parse(`<view><link href="https://example.com">x</link></view>`).ok).toBe(true);
    expect(parse(`<view><link href="/local">x</link></view>`).ok).toBe(true);
  });

  it('rejects out-of-range numbers and bad enums', () => {
    expectError(`<view><grid cols="9"></grid></view>`, /must be ≤ 6/);
    expectError(`<view><text tone="rainbow">x</text></view>`, /must be one of/);
  });

  it('rejects missing required attributes', () => {
    expectError(`<view><input label="no name" /></view>`, /missing required attribute "name"/);
  });

  it('rejects disallowed children', () => {
    expectError(`<view><list><text>not an item</text></list></view>`, /<list> may not contain <text>/);
    expectError(`<view><divider>nope</divider></view>`, /<divider> may not contain text/);
  });

  it('rejects structural errors', () => {
    expectError(`<view><card>unclosed`, /unclosed tag <card>/);
    expectError(`<view></card></view>`, /mismatched closing tag/);
    expectError(`<card>a</card><card>b</card>`, /exactly one root element/);
  });
});

describe('validateDoc', () => {
  it('passes a parsed (expanded) doc and flags a hand-built bad node', () => {
    const ok = parse(`<view><text>hi</text></view>`);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(validateDoc(ok.doc, DEFAULT_VIEW_TAGS)).toEqual([]);

    const bad = validateDoc(
      { root: { kind: 'element', tag: 'evil', props: {}, children: [] } },
      DEFAULT_VIEW_TAGS,
    );
    expect(bad.some((e) => /unknown tag <evil>/.test(e.message))).toBe(true);
  });
});
