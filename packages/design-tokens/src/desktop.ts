/**
 * The desktop's own palette pair. The shared `tokens` / `darkTokens` in
 * `./index.ts` are what mobile reads; the desktop renderer projects THESE to its
 * CSS custom properties instead, so the two surfaces can be restyled apart.
 *
 * The desktop is a messenger: the conversation is the product and everything
 * around it stays quiet. So the chrome is a neutral grey ramp with no hue of its
 * own, set in the platform's text face, and the geometry is rounded. Structure
 * comes from fills one step apart rather than from hairlines. The brand's Signal
 * orange is the only accent, and the status hues keep the meaning they have in
 * the shared palette.
 *
 * Both objects are shape-frozen against {@link tokens}: same keys, so every CSS
 * variable the renderer already reads keeps resolving.
 */

import { tokens, darkTokens, type ThemeTokens } from './index.js';

/* One face for chrome and prose. No bundled webfont: each platform's own text
 * face is what a native messenger uses, and it costs no dependency. */
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

const font = { chrome: SANS, prose: SANS, mono: MONO };

/* A readout is 4, a control or a row 6, a panel 8, a card 12. */
const radius = { tag: 4, chip: 6, block: 8, card: 12, pill: 9999 };

const type = {
  micro: 11,
  label: 12,
  meta: 12,
  row: 13,
  ui: 13,
  prose: 14,
  section: 18,
  display: 24,
};

const motion = { press: '120ms', shift: '160ms', overlay: '240ms', markTurn: '3400ms' };

export const desktopTokens: ThemeTokens = {
  color: {
    ...tokens.color,
    /* The list column is a step darker than the conversation beside it. */
    appBg: '#f4f4f4',
    mainBg: '#ffffff',
    surface: '#ffffff',
    inputSoft: '#ebebeb',
    cardBg: '#ffffff',
    cardBorder: '#e6e6e6',
    cardBorderStrong: '#d1d1d1',
    text: '#141414',
    textMuted: '#5e5e5e',
    textDim: '#7a7a7a',
    sidebarBg: '#f4f4f4',
    sidebarBgHover: '#eaeaea',
    /* The active row is a fill, not an accent wash: selection is not a command. */
    sidebarBgActive: '#e1e1e1',
    sidebarText: '#141414',
    sidebarTextDim: '#7a7a7a',
    sidebarBorder: '#e6e6e6',
    overlay: 'rgba(0, 0, 0, 0.32)',
  },
  shadow: {
    card: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 12px 32px -8px rgba(0, 0, 0, 0.16)',
  },
  font,
  radius,
  space: { ...tokens.space },
  type,
  frame: { ...tokens.frame },
  motion,
};

export const desktopDarkTokens: ThemeTokens = {
  color: {
    ...darkTokens.color,
    /* One canvas for the list and the conversation; rows and bubbles lift off it. */
    appBg: '#1a1a1a',
    mainBg: '#1a1a1a',
    surface: '#262626',
    inputSoft: '#242424',
    cardBg: '#212121',
    cardBorder: '#2c2c2c',
    cardBorderStrong: '#3a3a3a',
    text: '#f5f5f5',
    textMuted: '#a6a6a6',
    textDim: '#858585',
    sidebarBg: '#1a1a1a',
    sidebarBgHover: '#232323',
    sidebarBgActive: '#2a2a2a',
    sidebarText: '#f5f5f5',
    sidebarTextDim: '#858585',
    sidebarBorder: '#2c2c2c',
    /* The label on the luminous accent stays ink, now the neutral one. */
    onPrimary: '#141414',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
  shadow: {
    card: '0 0 0 1px rgba(255, 255, 255, 0.06), 0 12px 32px -8px rgba(0, 0, 0, 0.6)',
  },
  font,
  radius,
  space: { ...tokens.space },
  type,
  frame: { ...tokens.frame },
  motion,
};
