import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { tokens, darkTokens } from './index.js';
import {
  CSS_VAR_MAP,
  DARK_CSS_VAR_MAP,
  flattenTokens,
  generateRootCss,
  generateThemeCss,
} from './css-vars.js';

/** Recreate the generator's expected CSS-var name for an arbitrary token leaf,
 *  independent of css-vars.ts, so the parity test is a real cross-check rather
 *  than a tautology. Mirrors the documented convention + override table. */
const NAME_OVERRIDES: Record<string, string> = {
  'shadow.card': '--color-card-shadow',
  'gradient.user': '--grad-user',
  'gradient.cta': '--grad-cta',
  'gradient.accent': '--grad-accent',
};
function expectedVarName(path: string): string {
  const override = NAME_OVERRIDES[path];
  if (override) return override;
  return `--${path
    .split('.')
    .map((s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
    .join('-')}`;
}
function leafPaths(node: unknown, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') out.push(...leafPaths(v, path));
    else out.push(path);
  }
  return out;
}

describe('generateRootCss', () => {
  it('emits a :root block', () => {
    const css = generateRootCss();
    expect(css.startsWith(':root {\n')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('declares every mapped variable with its token value', () => {
    const css = generateRootCss();
    for (const [name, value] of CSS_VAR_MAP) {
      expect(css).toContain(`  ${name}: ${value};`);
    }
  });

  it('keeps the brand tokens parity with styles.css values', () => {
    const css = generateRootCss();
    // Spot-check the load-bearing brand declarations against the desktop CSS.
    expect(css).toContain('--color-primary: #ec4899;');
    expect(css).toContain('--color-app-bg: #f1f2f9;');
    expect(css).toContain('--color-main-bg: rgb(252, 252, 255);');
    expect(css).toContain('--color-surface: #ffffff;');
    expect(css).toContain(
      '--color-card-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 24px -18px rgba(15, 23, 42, 0.10);',
    );
    expect(css).toContain('--grad-cta: linear-gradient(135deg, #ec4899 0%, #db2777 100%);');
    expect(css).toContain('--radius-card: 14px;');
  });

  it('renders radii as numbers with a px unit (RN keeps the bare number)', () => {
    expect(tokens.radius.card).toBe(14);
    expect(generateRootCss()).toContain('--radius-card: 14px;');
  });
});

describe('generateThemeCss', () => {
  it('emits :root followed by a [data-theme="dark"] override block', () => {
    const css = generateThemeCss();
    expect(css.startsWith(':root {\n')).toBe(true);
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('color-scheme: dark;');
  });

  it('declares every dark-mapped variable with its darkTokens value', () => {
    const dark = generateThemeCss().split('[data-theme="dark"]')[1];
    if (dark === undefined) throw new Error('generated CSS contains a dark-theme block');
    for (const [name, value] of DARK_CSS_VAR_MAP) {
      expect(dark).toContain(`  ${name}: ${value};`);
    }
  });

  it('gives every light color/gradient var a dark counterpart (fonts/radii are theme-invariant)', () => {
    const lightNames = CSS_VAR_MAP.map(([n]) => n).filter(
      (n) => !n.startsWith('--font-') && !n.startsWith('--radius-'),
    );
    const darkNames = new Set(DARK_CSS_VAR_MAP.map(([n]) => n));
    for (const name of lightNames) {
      expect(darkNames.has(name), `${name} has no dark counterpart`).toBe(true);
    }
  });

  it('darkTokens has exactly the same flat color keys as tokens (shape frozen)', () => {
    expect(Object.keys(darkTokens.color).sort()).toEqual(Object.keys(tokens.color).sort());
    expect(Object.keys(darkTokens)).toEqual(Object.keys(tokens));
  });
});

/**
 * FORWARD parity: every leaf in `tokens` (and `darkTokens`) must reach a CSS
 * var. Without this, adding a token to index.ts but forgetting to wire it
 * silently drops it from CSS while every other test stays green — the package's
 * documented "single source of truth" guarantee would be a lie. Because the
 * generator now derives the map by flattening the object, this also pins the
 * derivation against an INDEPENDENT reimplementation of the naming convention.
 */
describe('forward token→CSS-var coverage', () => {
  it('every light token leaf is projected to its expected CSS var with its value', () => {
    const map = new Map<string, string>(CSS_VAR_MAP);
    const leaves = leafPaths(tokens);
    // Coverage: exactly one CSS var per leaf (no stray, no dropped).
    expect(map.size).toBe(leaves.length);
    for (const path of leaves) {
      const name = expectedVarName(path);
      expect(map.has(name), `token "${path}" has no CSS var (expected ${name})`).toBe(true);
      // Resolve the leaf value through the same convention the generator uses.
      const raw = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], tokens);
      const expected = typeof raw === 'number' ? `${raw}px` : String(raw);
      expect(map.get(name)).toBe(expected);
    }
  });

  it('every dark color/gradient leaf is projected (fonts/radii excluded by design)', () => {
    const map = new Map<string, string>(DARK_CSS_VAR_MAP);
    for (const path of leafPaths(darkTokens)) {
      const name = expectedVarName(path);
      if (name.startsWith('--font-') || name.startsWith('--radius-')) {
        expect(map.has(name), `${name} should NOT be in the dark map`).toBe(false);
        continue;
      }
      expect(map.has(name), `dark token "${path}" has no CSS var (expected ${name})`).toBe(true);
    }
  });

  it('flattenTokens rejects a non-finite numeric leaf loudly (no `NaNpx` in CSS)', () => {
    const bad = { radius: { block: Number.NaN } };
    expect(() => flattenTokens(bad)).toThrow(/non-finite/);
  });

  it('flattenTokens rejects unsupported leaf types loudly (no `[object Object]`)', () => {
    expect(() => flattenTokens({ color: { primary: true as unknown } })).toThrow(/unsupported/);
    expect(() => flattenTokens({ color: { primary: null } })).toThrow(/unsupported/);
    expect(() => flattenTokens('not-a-palette')).toThrow(/expected an object/);
    expect(() => flattenTokens(42)).toThrow(/expected an object/);
    expect(() => flattenTokens(undefined)).toThrow(/expected an object/);
  });

  it('flattenTokens rejects arrays loudly (no numeric-indexed `--color-foo-0` vars)', () => {
    // Array at the top level — must NOT be treated as a palette.
    expect(() => flattenTokens(['#fff', '#000'])).toThrow(/got array/);
    // Array as a leaf — must NOT be recursed into.
    expect(() => flattenTokens({ color: { primary: ['#fff'] as unknown } })).toThrow(
      /unsupported type array/,
    );
    // Array as a nested section — same.
    expect(() => flattenTokens({ color: ['#fff'] as unknown })).toThrow(/unsupported type array/);
  });

  it('flattenTokens rejects empty sections loudly (would silently emit no CSS vars)', () => {
    expect(() => flattenTokens({})).toThrow(/empty/);
    expect(() => flattenTokens({ color: {} })).toThrow(/section "color" is empty/);
  });

  it('flattenTokens covers exactly the real token leaves', () => {
    expect(flattenTokens(tokens).map((l) => l.path).sort()).toEqual(leafPaths(tokens).sort());
  });

  it('the name-override table has no stale entries (every override targets a real leaf)', () => {
    // A leftover override for a path that no longer exists in index.ts is dead
    // config that silently never fires — assert each override key is a real leaf.
    const realLeaves = new Set(leafPaths(tokens));
    for (const overriddenPath of Object.keys(NAME_OVERRIDES)) {
      expect(
        realLeaves.has(overriddenPath),
        `override for "${overriddenPath}" targets a path that is not a token leaf (stale)`,
      ).toBe(true);
    }
  });

  it('produces no duplicate CSS-var names (an override collision would silently drop a token)', () => {
    const names = CSS_VAR_MAP.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    const darkNames = DARK_CSS_VAR_MAP.map(([n]) => n);
    expect(new Set(darkNames).size).toBe(darkNames.length);
  });
});

/**
 * styles.css ↔ tokens parity. styles.css stays authoritative for the desktop;
 * these tests pin the two declarations of the palette together so an edit to
 * either side without the other fails loudly. Crucially they also enforce the
 * dark theme's completeness: ANY literal-color custom property declared in a
 * :root block (including the legacy aliases) that lacks a re-declaration in
 * the [data-theme="dark"] block would silently stay light in dark mode.
 */
const stylesPath = fileURLToPath(new URL('../../../apps/desktop/src/styles.css', import.meta.url));
// This is a low-level, app-neutral package; the sibling app it cross-checks may
// be renamed/removed/built outside this checkout. Don't hard-fail collection on
// ENOENT — skip the consumer-parity suite when its file isn't present.
const stylesExists = existsSync(stylesPath);

/** Extract the body (between matched braces) of the FIRST block whose header
 *  matches `headerRe`, using a brace-depth scanner so values that themselves
 *  carry braces (var() fallbacks, data-URIs) don't truncate the block at the
 *  first `}`. Returns null if no such block exists. */
function blockBody(source: string, headerRe: RegExp): string | null {
  const open = source.search(headerRe);
  if (open < 0) return null;
  const braceStart = source.indexOf('{', open);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(braceStart + 1, i);
  }
  return null; // unbalanced braces — caller treats as "no block"
}

/** All `:root { … }` block bodies (styles.css declares the palette across more
 *  than one :root block). */
function allRootBodies(source: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const slice = source.slice(from);
    const idx = slice.search(/(?:^|\n)\s*:root\s*\{/);
    if (idx < 0) break;
    const body = blockBody(slice.slice(idx), /:root\s*\{/);
    if (body === null) break;
    bodies.push(body);
    // Advance past this block's closing brace.
    const braceStart = slice.indexOf('{', idx);
    from += braceStart + body.length + 2;
  }
  return bodies;
}

describe.skipIf(!stylesExists)('apps/desktop styles.css parity', () => {
  // Strip comments so colors mentioned in prose don't trip the literal scan.
  const css = stylesExists
    ? readFileSync(stylesPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    : '';

  function declsOf(block: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const name = m[1];
      const value = m[2];
      if (name === undefined || value === undefined) continue;
      map.set(name, value.trim().replace(/\s+/g, ' '));
    }
    return map;
  }

  const rootDecls = new Map<string, string>();
  for (const body of allRootBodies(css)) {
    for (const [k, v] of declsOf(body)) rootDecls.set(k, v);
  }
  const darkBody = blockBody(css, /\[data-theme="dark"\]\s*\{/);
  const darkDecls = darkBody !== null ? declsOf(darkBody) : new Map<string, string>();

  it('found both the :root and the [data-theme="dark"] blocks', () => {
    expect(rootDecls.size).toBeGreaterThan(0);
    expect(darkDecls.size).toBeGreaterThan(0);
    expect(darkBody).toContain('color-scheme: dark');
  });

  it(':root matches the light tokens (CSS_VAR_MAP)', () => {
    for (const [name, value] of CSS_VAR_MAP) {
      expect(rootDecls.get(name), `:root ${name}`).toBe(value.replace(/\s+/g, ' '));
    }
  });

  it('[data-theme="dark"] matches the dark tokens (DARK_CSS_VAR_MAP)', () => {
    for (const [name, value] of DARK_CSS_VAR_MAP) {
      expect(darkDecls.get(name), `dark ${name}`).toBe(value.replace(/\s+/g, ' '));
    }
  });

  it('every literal-color :root var (incl. legacy aliases) is overridden in the dark block', () => {
    const hasLiteralColor = (v: string): boolean => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(v);
    for (const [name, value] of rootDecls) {
      if (!/^--(?:color|grad)-/.test(name)) continue;
      if (!hasLiteralColor(value)) continue; // pure var() aliases follow their target
      expect(darkDecls.has(name), `${name} (${value}) is missing from [data-theme="dark"]`).toBe(
        true,
      );
    }
  });
});
