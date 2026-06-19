/**
 * Project the {@link tokens} object to the desktop's CSS custom properties. The
 * variable NAMES are the exact ones the desktop's `styles.css` `:root` block
 * declares, so this generator can become the single source of that block. It's
 * shipped now but not yet consumed by the desktop (styles.css stays the source
 * of truth) — the parity test guards the mapping so a later switch is safe.
 *
 * TODO(design-tokens): cut apps/desktop over to {@link generateThemeCss} and
 * delete the duplicated `:root` / `[data-theme="dark"]` literals in styles.css.
 * Until then these generators are intentional, parity-tested scaffolding.
 *
 * Theming: {@link generateThemeCss} additionally emits a
 * `[data-theme="dark"]` block from {@link darkTokens}. The desktop's
 * `useTheme()` controller toggles `data-theme="dark"` on `<html>`; anything
 * reading the variables below re-themes for free.
 *
 * DRY: the `[cssVarName, value]` pairs are DERIVED from the token object by a
 * generic flatten (camelCase leaf path → kebab `--color-…`) so a new token in
 * `index.ts` flows to CSS automatically. The handful of names that don't follow
 * the convention live in {@link VAR_NAME_OVERRIDES}; the forward-parity test
 * asserts every leaf is covered.
 */

import { tokens, darkTokens, type ThemeTokens } from './index.js';

/** A flattened leaf of the token object: its dotted path plus the resolved value. */
interface TokenLeaf {
  /** Dotted path within the token object, e.g. `color.cardBorderStrong`. */
  readonly path: string;
  /** Leaf value, already stringified (radii carry a `px` unit). */
  readonly value: string;
}

/** CSS-var names that don't follow the default `--<section>-<kebab-leaf>`
 *  convention. Keyed by the leaf's dotted token path. Keeping these explicit
 *  (rather than special-casing inside the flatten) keeps the mapping declarative
 *  and lets the parity test prove the override table stays exhaustive. */
const VAR_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  'shadow.card': '--color-card-shadow',
  'gradient.user': '--grad-user',
  'gradient.cta': '--grad-cta',
  'gradient.accent': '--grad-accent',
};

/** `camelCase` → `kebab-case` for a single path segment. */
function kebab(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Map a leaf's dotted path to its CSS custom-property name, honoring the
 *  override table for the non-conventional names. */
function cssVarName(path: string): string {
  const override = VAR_NAME_OVERRIDES[path];
  if (override) return override;
  const segments = path.split('.');
  return `--${segments.map(kebab).join('-')}`;
}

/** Recursively flatten a token palette to ordered {@link TokenLeaf}s. Numbers
 *  (radii) are emitted with a `px` unit; strings are verbatim. Anything that is
 *  neither a string, a finite number, nor a plain nested object is rejected
 *  loudly — a malformed token (an array, a `NaN`, a `null`, a boolean, an
 *  empty section) must fail at generation time rather than silently emit
 *  `[object Object]` / `NaNpx` / `--color-foo-0` garbage into CSS.
 *
 *  Arrays are treated as INVALID leaves (not recursed into): a palette section
 *  that is an array is a mistake, and recursing would project numeric-indexed
 *  CSS vars (`--color-foo-0`) that no `:root` declares. An empty object section
 *  is likewise a mistake (it would contribute zero vars and silently shrink the
 *  generated block) and is rejected.
 *
 *  Exported (internal) so the guard is directly regression-tested; not part of
 *  the package's documented surface. */
export function flattenTokens(node: unknown, prefix = ''): TokenLeaf[] {
  const out: TokenLeaf[] = [];
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    // Only a plain object is a valid palette / palette section.
    const got = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
    throw new TypeError(
      `design-tokens: expected an object palette${prefix ? ` at "${prefix}"` : ''}, got ${got}`,
    );
  }
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length === 0) {
    throw new TypeError(
      `design-tokens: token section "${prefix || '(root)'}" is empty (would emit no CSS vars)`,
    );
  }
  for (const [key, raw] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === 'string') {
      out.push({ path, value: raw });
    } else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        throw new TypeError(`design-tokens: token "${path}" is a non-finite number`);
      }
      out.push({ path, value: `${raw}px` });
    } else if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      out.push(...flattenTokens(raw, path));
    } else {
      const type = raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw;
      throw new TypeError(`design-tokens: token "${path}" has unsupported type ${type}`);
    }
  }
  return out;
}

/** Build `[cssVarName, value]` pairs for one palette, in token-declaration order. */
function varPairs(t: ThemeTokens): ReadonlyArray<readonly [string, string]> {
  return flattenTokens(t).map(({ path, value }) => [cssVarName(path), value] as const);
}

/** `[cssVarName, value]` pairs for the LIGHT (default) palette. */
export const CSS_VAR_MAP: ReadonlyArray<readonly [string, string]> = varPairs(tokens);

/** `[cssVarName, value]` pairs for the DARK palette ({@link darkTokens}).
 *  Fonts and radii are theme-invariant, so the dark override block only
 *  carries the color-bearing variables. */
export const DARK_CSS_VAR_MAP: ReadonlyArray<readonly [string, string]> = varPairs(
  darkTokens,
).filter(([name]) => !name.startsWith('--font-') && !name.startsWith('--radius-'));

/** Render the light tokens as a `:root { … }` CSS block. */
export function generateRootCss(): string {
  const lines = CSS_VAR_MAP.map(([name, value]) => `  ${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Render both palettes: `:root { … }` (light, plus `color-scheme: light`)
 *  followed by a `[data-theme="dark"] { … }` override block. */
export function generateThemeCss(): string {
  const dark = DARK_CSS_VAR_MAP.map(([name, value]) => `  ${name}: ${value};`);
  return [
    generateRootCss(),
    '',
    `[data-theme="dark"] {\n${dark.join('\n')}\n  color-scheme: dark;\n}`,
  ].join('\n');
}
