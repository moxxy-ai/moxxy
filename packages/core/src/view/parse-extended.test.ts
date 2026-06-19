import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_TAGS, type ViewNode } from '@moxxy/sdk';
import { countNodes, parseView } from './parse.js';

const parse = (src: string) => parseView(src, DEFAULT_VIEW_TAGS);
const ok = (src: string) => {
  const r = parse(src);
  if (!r.ok) throw new Error(`expected ok, got errors: ${r.errors.map((e) => e.message).join('; ')}`);
  return r.doc;
};
const errs = (src: string): string[] => {
  const r = parse(src);
  if (r.ok) throw new Error('expected errors');
  return r.errors.map((e) => e.message);
};
const hasErr = (src: string, re: RegExp) => expect(errs(src).some((m) => re.test(m))).toBe(true);

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
function firstText(node: ViewNode): string | null {
  if (node.kind === 'text') return node.value;
  for (const c of node.children) {
    const t = firstText(c);
    if (t != null) return t;
  }
  return null;
}

describe('attribute coercion', () => {
  it('coerces booleans: bare, ="true", ="false"', () => {
    const doc = ok('<view><input name="a" required /><input name="b" required="true" /><input name="c" required="false" /></view>');
    const inputs = findAll(doc.root, 'input');
    expect(inputs[0]!.props.required).toBe(true);
    expect(inputs[1]!.props.required).toBe(true);
    expect(inputs[2]!.props.required).toBe(false);
  });

  it('coerces numbers including negatives and floats are range-checked', () => {
    expect(find(ok('<view><grid cols="4"></grid></view>').root, 'grid')!.props.cols).toBe(4);
    hasErr('<view><grid cols="0"></grid></view>', /must be ≥ 1/);
    hasErr('<view><grid cols="abc"></grid></view>', /must be a number/);
    hasErr('<view><heading level="5">x</heading></view>', /must be ≤ 3/);
  });

  it('rejects JS numeric-literal syntax (hex/binary/octal/exponent) — only plain decimals', () => {
    // `Number()` would silently turn these into surprising values: `0x4`→4 (a
    // human reads hex 16), `0b100`→4, `1e1`→10. The agent must get a clear error
    // instead of a guessed value that doesn't match what it typed.
    hasErr('<view><grid cols="0x4"></grid></view>', /must be a number/);
    hasErr('<view><grid cols="0b100"></grid></view>', /must be a number/);
    hasErr('<view><grid cols="0o7"></grid></view>', /must be a number/);
    hasErr('<view><grid cols="1e1"></grid></view>', /must be a number/);
    hasErr('<view><grid cols="Infinity"></grid></view>', /must be a number/);
    // Plain decimals (incl. whitespace-padded, signed, fractional) still coerce.
    expect(find(ok('<view><grid cols="  3  "></grid></view>').root, 'grid')!.props.cols).toBe(3);
    expect(find(ok('<view><image src="/x" w="1.5" /></view>').root, 'image')!.props.w).toBe(1.5);
    expect(find(ok('<view><image src="/x" w="-2" /></view>').root, 'image')!.props.w).toBe(-2);
  });

  it('validates each enum attribute', () => {
    ok('<view><stack gap="lg" align="center"></stack></view>');
    ok('<view><row justify="between"></row></view>');
    ok('<view><text tone="muted" weight="bold">x</text></view>');
    ok('<view><button action="a" label="b" variant="danger" /></view>');
    ok('<view><input name="n" type="email" /></view>');
    hasErr('<view><stack gap="huge"></stack></view>', /gap.*must be one of/);
    hasErr('<view><input name="n" type="color" /></view>', /type.*must be one of/);
    hasErr('<view><button action="a" label="b" variant="rainbow" /></view>', /variant.*must be one of/);
  });

  it('rejects a value-less non-boolean attribute', () => {
    hasErr('<view><text tone>x</text></view>', /tone.*must be one of|expects a value/);
  });

  it('parses single-quoted, double-quoted, and brace values', () => {
    const doc = ok(`<view title='single'><image src="https://x/i.png" alt='a "b"' /></view>`);
    expect(doc.title).toBe('single');
  });
});

describe('text + entities + comments', () => {
  it('decodes entities and collapses whitespace', () => {
    const doc = ok('<view><text>a &amp; b   &lt;tag&gt;  &quot;q&quot;</text></view>');
    expect(firstText(find(doc.root, 'text')!)).toBe('a & b <tag> "q"');
  });

  it('decodes decimal + hex numeric character references in text', () => {
    const doc = ok('<view><text>&#x3C;&#60; &#9731; &#x263A;</text></view>');
    expect(firstText(find(doc.root, 'text')!)).toBe('<< ☃ ☺');
  });

  it('decodes entities in a single pass — a double-encoded ampersand is not re-decoded', () => {
    // `&amp;#58;` must become the literal `&#58;`, not `:` (which a chained
    // replace of `&amp;`-then-`&#58;` would wrongly produce).
    const doc = ok('<view><text>a &amp;#58; b</text></view>');
    expect(firstText(find(doc.root, 'text')!)).toBe('a &#58; b');
  });

  it('leaves an out-of-range / malformed numeric reference as literal text', () => {
    const doc = ok('<view><text>&#xZZ; &#999999999; ok</text></view>');
    expect(firstText(find(doc.root, 'text')!)).toBe('&#xZZ; &#999999999; ok');
  });

  it('drops whitespace-only text nodes', () => {
    const doc = ok('<view>\n  <stack>\n    <text>hi</text>\n  </stack>\n</view>');
    const stack = find(doc.root, 'stack')!;
    expect(stack.children.every((c) => c.kind === 'element')).toBe(true);
  });

  it('strips comments', () => {
    const doc = ok('<view><!-- a comment --><text>x</text></view>');
    expect(find(doc.root, 'text')).not.toBeNull();
  });

  it('treats self-closing and explicit-close equivalently', () => {
    expect(ok('<view><divider /></view>')).toBeTruthy();
    // divider is a void element; an explicit close with content would error,
    // but an empty explicit close is acceptable structurally.
    expect(parse('<view><divider></divider></view>').ok).toBe(true);
  });
});

describe('nesting rules', () => {
  it('accepts table → tr → th/td', () => {
    ok('<view><table><tr><th>H</th></tr><tr><td>1</td></tr></table></view>');
  });
  it('rejects table → td directly (must be tr)', () => {
    hasErr('<view><table><td>x</td></table></view>', /<table> may not contain <td>/);
  });
  it('rejects list → text (must be item)', () => {
    hasErr('<view><list><text>x</text></list></view>', /<list> may not contain <text>/);
  });
  it('accepts list → item', () => {
    ok('<view><list ordered="true"><item>one</item><item>two</item></list></view>');
  });
  it('rejects select → input (must be option)', () => {
    hasErr('<view><select name="s"><input name="x" /></select></view>', /<select> may not contain <input>/);
  });
  it('rejects children on void elements', () => {
    hasErr('<view><image src="https://x/i.png">child</image></view>', /<image> may not have children|may not contain text/);
  });
});

describe('structural errors collect or fail clearly', () => {
  it('reports multiple validation errors in one pass', () => {
    const messages = errs('<view><blink/><text foo="1">x</text></view>');
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });
  it('unbalanced / mismatched / multi-root', () => {
    hasErr('<view><card>', /unclosed tag <card>/);
    hasErr('<view><card></row></view>', /mismatched closing tag/);
    hasErr('<a/><b/>', /exactly one root element/);
    hasErr('   ', /exactly one root element|root/);
  });
});

describe('security rejections', () => {
  it('rejects script/style/iframe/object tags as unknown', () => {
    for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'svg']) {
      hasErr(`<view><${tag}>x</${tag}></view>`, new RegExp(`unknown tag <${tag}>`));
    }
  });
  it('rejects every on* handler attribute', () => {
    for (const h of ['onclick', 'onload', 'onerror', 'onmouseover']) {
      hasErr(`<view><button action="a" label="b" ${h}="evil()" /></view>`, /forbidden attribute/);
    }
  });
  it('URL scheme allow-list on href and src', () => {
    ok('<view><link href="https://ok.com">x</link></view>');
    ok('<view><link href="mailto:a@b.com">x</link></view>');
    ok('<view><link href="/relative/path">x</link></view>');
    ok('<view><link href="#anchor">x</link></view>');
    ok('<view><image src="data:image/png;base64,AAAA" /></view>');
    hasErr('<view><link href="javascript:alert(1)">x</link></view>', /disallowed URL scheme/);
    hasErr('<view><link href="vbscript:x">y</link></view>', /disallowed URL scheme/);
    hasErr('<view><image src="data:text/html,<script>" />\n</view>', /disallowed URL scheme/);
    hasErr('<view><link href="ftp://x">y</link></view>', /disallowed URL scheme/);
  });

  it('numeric-entity-obfuscated scheme is decoded then rejected (no relative-URL bypass)', () => {
    // A browser decodes `&#58;`/`&#x3a;` to `:` at click time, so the parser
    // must too BEFORE the scheme check — otherwise `javascript&#58;alert(1)`
    // looks like a harmless relative URL here yet executes as javascript: in the
    // shared view. (Named-only entity decoding missed these → live click-XSS.)
    hasErr('<view><link href="javascript&#58;alert(1)">x</link></view>', /disallowed URL scheme/);
    hasErr('<view><link href="javascript&#x3a;alert(1)">x</link></view>', /disallowed URL scheme/);
    hasErr('<view><link href="java&#115;cript:alert(1)">x</link></view>', /disallowed URL scheme/);
    hasErr('<view><image src="data&#58;text/html,x" /></view>', /disallowed URL scheme/);
    // A double-encoded ampersand must NOT be re-decoded into a live scheme.
    ok('<view><link href="https://x/?a&amp;#58;b">y</link></view>');
  });
});

describe('action extraction', () => {
  it('form action carries all descendant field names (excluding buttons)', () => {
    const doc = ok(`
      <view><form action="go" submit="Go">
        <input name="a" /><row><select name="b"><option value="x">x</option></select></row>
        <checkbox name="c" /><button action="other" label="Other" />
      </form></view>`);
    const form = find(doc.root, 'form')!;
    expect(form.action?.name).toBe('go');
    expect(form.action?.fields).toEqual(['a', 'b', 'c']);
  });
  it('standalone button parses fields csv (trimmed, empties dropped)', () => {
    const doc = ok('<view><button action="x" label="L" fields=" a , ,b " /></view>');
    expect(find(doc.root, 'button')!.action?.fields).toEqual(['a', 'b']);
  });
  it('button with no fields has empty fields array', () => {
    const doc = ok('<view><button action="x" label="L" /></view>');
    expect(find(doc.root, 'button')!.action?.fields).toEqual([]);
  });
});

describe('client-side navigation (to → nav)', () => {
  it('sets node.nav from a `to` on a link and on a button', () => {
    const doc = ok('<view><link to="search">Back</link><button to="results" label="Results" /></view>');
    expect(find(doc.root, 'link')!.nav).toBe('search');
    expect(find(doc.root, 'button')!.nav).toBe('results');
  });
  it('a button with action (no to) carries an action, not nav', () => {
    const doc = ok('<view><button action="go" label="Go" /></view>');
    const b = find(doc.root, 'button')!;
    expect(b.action?.name).toBe('go');
    expect(b.nav).toBeUndefined();
  });
  it('reads the view name onto the root props', () => {
    const doc = ok('<view name="search" title="Search">x</view>');
    const root = doc.root as Extract<typeof doc.root, { kind: 'element' }>;
    expect(root.props.name).toBe('search');
  });
});

describe('results expansion', () => {
  const doc = ok(`
    <view><results>
      <result id="UA42" title="United SFO→JFK" subtitle="08:10 → 16:45" badge="$312" />
      <result id="B6-11" title="JetBlue SFO→JFK" subtitle="11:30 → 20:05" badge="$289" />
    </results></view>`);

  it('removes component tags and emits one card per result', () => {
    expect(find(doc.root, 'results')).toBeNull();
    expect(find(doc.root, 'result')).toBeNull();
    expect(findAll(doc.root, 'card')).toHaveLength(2);
  });
  it('defaults each result to an open:<id> action button', () => {
    const buttons = findAll(doc.root, 'button');
    expect(buttons.map((b) => b.action?.name)).toEqual(['open:UA42', 'open:B6-11']);
  });
  it('renders title, subtitle and badge in the tree', () => {
    const texts = findAll(doc.root, 'text').map(firstText);
    expect(texts).toContain('United SFO→JFK');
    expect(texts).toContain('08:10 → 16:45');
    expect(findAll(doc.root, 'badge').map(firstText)).toContain('$312');
  });
  it('honours an explicit `to` (client nav) or `action` over the default', () => {
    const d = ok('<view><results><result title="A" to="detail:a" /><result title="B" action="buy:b" /></results></view>');
    const buttons = findAll(d.root, 'button');
    expect(buttons[0]!.nav).toBe('detail:a');
    expect(buttons[1]!.action?.name).toBe('buy:b');
  });
  it('an expanded tree contains no component tags', () => {
    expect(findAll(doc.root, 'results').length + findAll(doc.root, 'result').length).toBe(0);
  });
});

describe('countNodes', () => {
  it('counts elements and text nodes', () => {
    const doc = ok('<view><text>a</text><text>b</text></view>');
    // view + 2 text elements + 2 text nodes = 5
    expect(countNodes(doc.root)).toBe(5);
  });
});

describe('large / deep documents', () => {
  it('parses deeply nested stacks', () => {
    let inner = '<text>deep</text>';
    for (let i = 0; i < 40; i++) inner = `<stack>${inner}</stack>`;
    const doc = ok(`<view>${inner}</view>`);
    expect(firstText(doc.root)).toBe('deep');
  });

  it('rejects nesting past the depth cap instead of overflowing the stack', () => {
    let inner = '<text>deep</text>';
    for (let i = 0; i < 1000; i++) inner = `<stack>${inner}</stack>`;
    const r = parse(`<view>${inner}</view>`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /view nesting too deep/.test(e.message))).toBe(true);
  });
});

describe('brace attribute values', () => {
  it('strips outer braces and treats the inner text as the literal value', () => {
    const doc = ok('<view><text>{plain}</text><image src="/x.png" alt={hello} /></view>');
    expect(find(doc.root, 'image')!.props.alt).toBe('hello');
  });

  it('runs the URL-scheme check on the de-braced value (no { } bypass)', () => {
    // The braces must NOT classify `{javascript:…}` as a harmless relative URL.
    hasErr('<view><link href={javascript:alert(1)}>x</link></view>', /disallowed URL scheme/);
    ok('<view><link href={https://ok.test/}>x</link></view>');
  });
});

describe('component allow-list / expander coverage', () => {
  it('rejects a component-flagged tag that has no registered expander', () => {
    const allow = [
      { tag: 'view', attrs: {}, allowedChildren: 'any' as const },
      { tag: 'widget', attrs: {}, allowedChildren: 'none' as const, component: true },
    ];
    const r = parseView('<view><widget /></view>', allow);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /no registered expander/.test(e.message))).toBe(true);
  });
});
