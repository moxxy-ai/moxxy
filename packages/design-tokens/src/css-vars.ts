/**
 * Project the {@link tokens} object to the desktop's CSS custom properties. The
 * variable NAMES are the exact ones the desktop's `styles.css` `:root` block
 * declares, so this generator can become the single source of that block. It's
 * shipped now but not yet consumed by the desktop (styles.css stays the source
 * of truth) — the parity test guards the mapping so a later switch is safe.
 *
 * Theming: {@link generateThemeCss} additionally emits a
 * `[data-theme="dark"]` block from {@link darkTokens}. The desktop's
 * `useTheme()` controller toggles `data-theme="dark"` on `<html>`; anything
 * reading the variables below re-themes for free.
 */

import { tokens, darkTokens, type ThemeTokens } from './index.js';

/** Build `[cssVarName, value]` pairs for one palette, in the desktop's
 *  declaration order. Numbers (radii) are emitted with a `px` unit;
 *  everything else is verbatim. */
function varPairs(t: ThemeTokens): ReadonlyArray<readonly [string, string]> {
  return [
    ['--color-app-bg', t.color.appBg],
    ['--color-main-bg', t.color.mainBg],
    ['--color-surface', t.color.surface],
    ['--color-input-soft', t.color.inputSoft],
    ['--color-card-bg', t.color.cardBg],
    ['--color-card-border', t.color.cardBorder],
    ['--color-card-border-strong', t.color.cardBorderStrong],
    ['--color-card-shadow', t.shadow.card],
    ['--color-text', t.color.text],
    ['--color-text-muted', t.color.textMuted],
    ['--color-text-dim', t.color.textDim],
    ['--color-sidebar-bg', t.color.sidebarBg],
    ['--color-sidebar-bg-hover', t.color.sidebarBgHover],
    ['--color-sidebar-bg-active', t.color.sidebarBgActive],
    ['--color-sidebar-text', t.color.sidebarText],
    ['--color-sidebar-text-dim', t.color.sidebarTextDim],
    ['--color-sidebar-border', t.color.sidebarBorder],
    ['--color-primary', t.color.primary],
    ['--color-primary-strong', t.color.primaryStrong],
    ['--color-primary-soft', t.color.primarySoft],
    ['--color-send', t.color.send],
    ['--color-accent', t.color.accent],
    ['--color-accent-strong', t.color.accentStrong],
    ['--color-purple', t.color.purple],
    ['--color-green', t.color.green],
    ['--color-amber', t.color.amber],
    ['--color-pink', t.color.pink],
    ['--color-red', t.color.red],
    ['--grad-user', t.gradient.user],
    ['--grad-cta', t.gradient.cta],
    ['--grad-accent', t.gradient.accent],
    ['--font-sans', t.font.sans],
    ['--font-mono', t.font.mono],
    ['--radius-block', `${t.radius.block}px`],
    ['--radius-card', `${t.radius.card}px`],
    ['--radius-pill', `${t.radius.pill}px`],
  ];
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
