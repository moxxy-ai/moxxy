/**
 * Project the {@link tokens} object to the desktop's CSS custom properties. The
 * variable NAMES are the exact ones the desktop's `styles.css` `:root` block
 * declares, so this generator can become the single source of that block. It's
 * shipped now but not yet consumed by the desktop (styles.css stays the source
 * of truth) — the parity test guards the mapping so a later switch is safe.
 */

import { tokens } from './index.js';

/** `[cssVarName, value]` pairs, in the desktop's declaration order. Numbers
 *  (radii) are emitted with a `px` unit; everything else is verbatim. */
export const CSS_VAR_MAP: ReadonlyArray<readonly [string, string]> = [
  ['--color-app-bg', tokens.color.appBg],
  ['--color-card-bg', tokens.color.cardBg],
  ['--color-card-border', tokens.color.cardBorder],
  ['--color-card-border-strong', tokens.color.cardBorderStrong],
  ['--color-card-shadow', tokens.shadow.card],
  ['--color-text', tokens.color.text],
  ['--color-text-muted', tokens.color.textMuted],
  ['--color-text-dim', tokens.color.textDim],
  ['--color-sidebar-bg', tokens.color.sidebarBg],
  ['--color-sidebar-bg-hover', tokens.color.sidebarBgHover],
  ['--color-sidebar-bg-active', tokens.color.sidebarBgActive],
  ['--color-sidebar-text', tokens.color.sidebarText],
  ['--color-sidebar-text-dim', tokens.color.sidebarTextDim],
  ['--color-sidebar-border', tokens.color.sidebarBorder],
  ['--color-primary', tokens.color.primary],
  ['--color-primary-strong', tokens.color.primaryStrong],
  ['--color-primary-soft', tokens.color.primarySoft],
  ['--color-send', tokens.color.send],
  ['--color-accent', tokens.color.accent],
  ['--color-accent-strong', tokens.color.accentStrong],
  ['--color-purple', tokens.color.purple],
  ['--color-green', tokens.color.green],
  ['--color-amber', tokens.color.amber],
  ['--color-pink', tokens.color.pink],
  ['--color-red', tokens.color.red],
  ['--grad-user', tokens.gradient.user],
  ['--grad-cta', tokens.gradient.cta],
  ['--grad-accent', tokens.gradient.accent],
  ['--font-sans', tokens.font.sans],
  ['--font-mono', tokens.font.mono],
  ['--radius-block', `${tokens.radius.block}px`],
  ['--radius-card', `${tokens.radius.card}px`],
  ['--radius-pill', `${tokens.radius.pill}px`],
];

/** Render the tokens as a `:root { … }` CSS block. */
export function generateRootCss(): string {
  const lines = CSS_VAR_MAP.map(([name, value]) => `  ${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}
