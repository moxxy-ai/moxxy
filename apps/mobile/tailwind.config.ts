import type { Config } from 'tailwindcss';
import nativeWindPreset from 'nativewind/preset';
// By dist path, not the `@moxxy/design-tokens` specifier: Tailwind loads this
// config through jiti, whose `require`-semantics resolution rejects the
// package's import-only exports map.
import { tokens } from '../../packages/design-tokens/dist/index.js';

/**
 * theme.extend is derived from @moxxy/design-tokens — the same source the
 * desktop renderer projects to CSS variables. Mapping:
 *   colors.*       ← tokens.color (muted/dim alias textMuted/textDim)
 *   borderRadius.* ← tokens.radius (bare numbers; Tailwind wants `px`)
 *   boxShadow.card ← tokens.shadow.card
 *   fontFamily.*   ← tokens.font (already full CSS font stacks)
 * Nothing is inlined here — if a value looks wrong, fix the tokens package.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  presets: [nativeWindPreset],
  theme: {
    extend: {
      colors: {
        appBg: tokens.color.appBg,
        cardBg: tokens.color.cardBg,
        cardBorder: tokens.color.cardBorder,
        cardBorderStrong: tokens.color.cardBorderStrong,
        text: tokens.color.text,
        muted: tokens.color.textMuted,
        dim: tokens.color.textDim,
        primary: tokens.color.primary,
        primaryStrong: tokens.color.primaryStrong,
        primarySoft: tokens.color.primarySoft,
        accent: tokens.color.accent,
        accentStrong: tokens.color.accentStrong,
        purple: tokens.color.purple,
        green: tokens.color.green,
        amber: tokens.color.amber,
        red: tokens.color.red,
      },
      borderRadius: {
        block: `${tokens.radius.block}px`,
        card: `${tokens.radius.card}px`,
        pill: `${tokens.radius.pill}px`,
      },
      boxShadow: {
        card: tokens.shadow.card,
      },
      fontFamily: {
        sans: [tokens.font.sans],
        mono: [tokens.font.mono],
      },
    },
  },
} satisfies Config;
