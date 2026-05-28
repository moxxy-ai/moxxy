/**
 * @moxxy/ui-tokens — shared design tokens.
 *
 * Tokens live in `./tokens.css` and `./motifs.css`. Consumers import the CSS
 * directly; this module exports typed mirrors for JS code that needs the
 * raw colour values (inline styles, canvas, brand picker).
 */

export interface ThemeTokens {
  readonly bg: string;
  readonly bgSecondary: string;
  readonly bgCard: string;
  readonly bgCardHover: string;
  readonly border: string;
  readonly borderLight: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textDim: string;
  readonly primary: string;
  readonly primaryStrong: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly purple: string;
  readonly green: string;
  readonly orange: string;
  readonly pink: string;
}

export const darkTokens: ThemeTokens = Object.freeze({
  bg: '#08080c',
  bgSecondary: '#0c0c13',
  bgCard: '#111119',
  bgCardHover: '#16161f',
  border: '#20202c',
  borderLight: '#32324a',
  text: '#e8e8f2',
  textMuted: '#9595ac',
  textDim: '#686d86',
  primary: '#818cf8',
  primaryStrong: '#6366f1',
  accent: '#22d3ee',
  accentStrong: '#0891b2',
  purple: '#a78bfa',
  green: '#34d399',
  orange: '#fb923c',
  pink: '#f472b6',
});

export const lightTokens: ThemeTokens = Object.freeze({
  bg: '#fbfcfe',
  bgSecondary: '#f1f3f9',
  bgCard: '#ffffff',
  bgCardHover: '#f5f7fc',
  border: '#dadeec',
  borderLight: '#c2c8dd',
  text: '#14151f',
  textMuted: '#4e5269',
  textDim: '#5a5a72',
  primary: '#6366f1',
  primaryStrong: '#4f46e5',
  accent: '#0e7490',
  accentStrong: '#0891b2',
  purple: '#7c3aed',
  green: '#047857',
  orange: '#c2410c',
  pink: '#be185d',
});

export type ThemeName = 'dark' | 'light';

export function tokensFor(theme: ThemeName): ThemeTokens {
  return theme === 'light' ? lightTokens : darkTokens;
}

export const deskSwatches = Object.freeze([
  darkTokens.primary,
  darkTokens.accent,
  darkTokens.purple,
  darkTokens.green,
  darkTokens.orange,
  darkTokens.pink,
] as const);
