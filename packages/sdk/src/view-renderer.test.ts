import { describe, expect, it } from 'vitest';
import {
  VIEW_PRIMITIVES,
  VIEW_COMPONENTS,
  DEFAULT_VIEW_TAGS,
  countNodes,
  isSafeViewUrl,
  defineViewRenderer,
  defineTunnelProvider,
  type ViewNode,
  type ViewTagSpec,
} from './index.js';

describe('countNodes', () => {
  const text = (value: string): ViewNode => ({ kind: 'text', value });
  const el = (tag: string, children: ViewNode[] = []): ViewNode => ({
    kind: 'element',
    tag,
    props: {},
    children,
  });

  it('counts a single text node as 1', () => {
    expect(countNodes(text('hi'))).toBe(1);
  });

  it('counts an element plus its descendants', () => {
    const tree = el('col', [el('row', [text('a'), text('b')]), text('c')]);
    // col + row + a + b + c = 5
    expect(countNodes(tree)).toBe(5);
  });

  it('counts a leaf element as 1', () => {
    expect(countNodes(el('hr'))).toBe(1);
  });
});

describe('view vocabulary integrity', () => {
  const all = DEFAULT_VIEW_TAGS;

  it('DEFAULT_VIEW_TAGS is primitives + components', () => {
    expect(all.length).toBe(VIEW_PRIMITIVES.length + VIEW_COMPONENTS.length);
  });

  it('has no duplicate tag names', () => {
    const names = all.map((t) => t.tag);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tag has a valid allowedChildren', () => {
    for (const t of all) {
      const ac = t.allowedChildren;
      const valid = ac === 'any' || ac === 'none' || Array.isArray(ac);
      expect(valid, `${t.tag} allowedChildren`).toBe(true);
    }
  });

  it('every array allowedChildren references known tags', () => {
    const known = new Set(all.map((t) => t.tag));
    for (const t of all) {
      if (Array.isArray(t.allowedChildren)) {
        for (const child of t.allowedChildren) {
          expect(known.has(child), `${t.tag} -> ${child}`).toBe(true);
        }
      }
    }
  });

  it('enum attrs declare their allowed values; number attrs may declare bounds', () => {
    for (const t of all) {
      for (const [name, spec] of Object.entries(t.attrs)) {
        if (spec.type === 'enum') {
          expect(Array.isArray(spec.values) && spec.values.length > 0, `${t.tag}.${name}`).toBe(true);
        }
      }
    }
  });

  it('marks interactive elements and rich components correctly', () => {
    const byTag = (tag: string): ViewTagSpec => all.find((t) => t.tag === tag)!;
    expect(byTag('form').interactive).toBe(true);
    expect(byTag('button').interactive).toBe(true);
    expect(byTag('text').interactive).toBeUndefined();
    expect(VIEW_COMPONENTS.every((c) => c.component)).toBe(true);
    expect(VIEW_PRIMITIVES.every((p) => !p.component)).toBe(true);
  });

  it('declares the expected required attributes', () => {
    const required = (tag: string) =>
      Object.entries(DEFAULT_VIEW_TAGS.find((t) => t.tag === tag)!.attrs)
        .filter(([, s]) => s.required)
        .map(([n]) => n)
        .sort();
    expect(required('input')).toEqual(['name']);
    expect(required('form')).toEqual(['action']);
    // action is optional on button now (a button may navigate via `to` instead).
    expect(required('button')).toEqual(['label']);
    expect(required('image')).toEqual(['src']);
    expect(required('option')).toEqual(['value']);
    expect(required('result')).toEqual(['title']);
  });
});

describe('define factories freeze their specs', () => {
  it('defineViewRenderer', () => {
    const def = defineViewRenderer({ name: 'x', allowList: [], parse: () => ({ ok: false, errors: [] }), validate: () => [] });
    expect(Object.isFrozen(def)).toBe(true);
    expect(() => {
      (def as { name: string }).name = 'y';
    }).toThrow();
  });

  it('defineTunnelProvider', () => {
    const def = defineTunnelProvider({ name: 't', open: () => Promise.resolve({ url: 'http://x', close: () => Promise.resolve() }) });
    expect(Object.isFrozen(def)).toBe(true);
  });
});

describe('isSafeViewUrl', () => {
  it('rejects javascript/vbscript/data-text schemes', () => {
    expect(isSafeViewUrl('javascript:alert(1)', 'href')).toBe(false);
    expect(isSafeViewUrl('vbscript:msgbox', 'href')).toBe(false);
    expect(isSafeViewUrl('data:text/html,<x>', 'src')).toBe(false);
  });

  it('rejects schemes split by whitespace/control chars (audit u72-1)', () => {
    // a browser strips tab/newline/CR before scheme resolution, so these
    // collapse to javascript: on click; the gate must normalize the same way
    expect(isSafeViewUrl('java\tscript:alert(1)', 'href')).toBe(false);
    expect(isSafeViewUrl('java\nscript:alert(1)', 'href')).toBe(false);
    expect(isSafeViewUrl('java\rscript:alert(1)', 'href')).toBe(false);
    expect(isSafeViewUrl('\u0000javascript:alert(1)', 'href')).toBe(false);
    expect(isSafeViewUrl('  javascript:alert(1)', 'href')).toBe(false);
  });

  it('allows safe schemes + relative + data-image src', () => {
    expect(isSafeViewUrl('https://example.com/x', 'href')).toBe(true);
    expect(isSafeViewUrl('http://example.com', 'href')).toBe(true);
    expect(isSafeViewUrl('mailto:a@b.com', 'href')).toBe(true);
    expect(isSafeViewUrl('tel:+1555', 'href')).toBe(true);
    expect(isSafeViewUrl('/relative/path', 'href')).toBe(true);
    expect(isSafeViewUrl('#frag', 'href')).toBe(true);
    expect(isSafeViewUrl('  https://example.com  ', 'href')).toBe(true);
    expect(isSafeViewUrl('data:image/png;base64,AAAA', 'src')).toBe(true);
    expect(isSafeViewUrl('data:image/png;base64,AAAA', 'href')).toBe(false);
  });
});
