import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { tokens, darkTokens } from './index.js';
import { CSS_VAR_MAP, DARK_CSS_VAR_MAP, generateRootCss, generateThemeCss } from './css-vars.js';

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
    const dark = generateThemeCss().split('[data-theme="dark"]')[1]!;
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
 * styles.css ↔ tokens parity. styles.css stays authoritative for the desktop;
 * these tests pin the two declarations of the palette together so an edit to
 * either side without the other fails loudly. Crucially they also enforce the
 * dark theme's completeness: ANY literal-color custom property declared in a
 * :root block (including the legacy aliases) that lacks a re-declaration in
 * the [data-theme="dark"] block would silently stay light in dark mode.
 */
describe('apps/desktop styles.css parity', () => {
  const stylesPath = fileURLToPath(
    new URL('../../../apps/desktop/src/styles.css', import.meta.url),
  );
  // Strip comments so colors mentioned in prose don't trip the literal scan.
  const css = readFileSync(stylesPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  function declsOf(block: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      map.set(m[1]!, m[2]!.trim().replace(/\s+/g, ' '));
    }
    return map;
  }

  const rootDecls = new Map<string, string>();
  for (const m of css.matchAll(/(?:^|\n)\s*:root\s*\{([^}]*)\}/g)) {
    for (const [k, v] of declsOf(m[1]!)) rootDecls.set(k, v);
  }
  const darkMatch = css.match(/\[data-theme="dark"\]\s*\{([^}]*)\}/);
  const darkDecls = darkMatch ? declsOf(darkMatch[1]!) : new Map<string, string>();

  it('found both the :root and the [data-theme="dark"] blocks', () => {
    expect(rootDecls.size).toBeGreaterThan(0);
    expect(darkDecls.size).toBeGreaterThan(0);
    expect(darkMatch?.[1]).toContain('color-scheme: dark');
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
