/**
 * The moxxy design tokens — one framework-neutral source of truth for colors,
 * typography, radii, gradients, and shadows. The desktop renderer projects these
 * to CSS custom properties (see `./css-vars`); a React Native app consumes the
 * same object directly in `StyleSheet.create`. Values mirror the desktop's
 * `styles.css` `:root` block.
 *
 * Radii are plain numbers (CSS appends `px`; RN wants the bare number).
 * Gradients are CSS gradient strings (web-only; RN would map these to a gradient
 * component) and are intentionally kept here so the brand definitions live in
 * one place.
 */

export const tokens = {
  color: {
    /* z.ai-style neutral canvas — a warm off-white/light-grey. */
    appBg: '#f7f7f5',
    /* Main chat column — pure white; it reads as the bright surface
     * against the grey canvas + grey sidebar. */
    mainBg: '#ffffff',
    /* Resting surface for buttons / chips / inputs that sit ON a card
     * or column (the things that were hard-coded `#fff`). */
    surface: '#ffffff',
    /* Recessed "soft" input fill — a neutral grey a step below the surface
     * (TextInput/TextArea tone='soft', modal fields). */
    inputSoft: '#f3f3f1',
    cardBg: '#ffffff',
    cardBorder: '#ebebe8',
    cardBorderStrong: '#d6d6d2',
    text: '#18181b',
    textMuted: '#52525b',
    textDim: '#a1a1aa',
    /* Sidebar is the grey; the main column is the white (z.ai inverts the
     * old "sidebar white / canvas off-white"). */
    sidebarBg: '#f7f7f5',
    sidebarBgHover: '#efefec',
    sidebarBgActive: '#e9e9e6' /* neutral grey active row (was a pink wash) */,
    sidebarText: '#18181b',
    sidebarTextDim: '#71717a',
    sidebarBorder: '#ebebe8',
    /* Brand accent — pink is kept (sparingly) for the send button, focus
     * ring, and active accents per the redesign decision. */
    primary: '#ec4899',
    primaryStrong: '#db2777',
    primarySoft: '#fdf2f8',
    send: '#ec4899',
    accent: '#22d3ee',
    accentStrong: '#06b6d4',
    purple: '#8b5cf6',
    green: '#10b981',
    amber: '#f59e0b',
    pink: '#ec4899',
    red: '#ef4444',
    /* Near-black "ink" action color — z.ai's dark pills / Share button.
     * Flips to near-white in dark so dark pills read as light-on-dark. */
    ink: '#18181b',
  },
  shadow: {
    card: '0 1px 2px rgba(24, 24, 27, 0.04), 0 8px 24px -18px rgba(24, 24, 27, 0.06)',
  },
  gradient: {
    user: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
    cta: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
    accent: 'linear-gradient(135deg, #38bdf8 0%, #22d3ee 100%)',
  },
  font: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    /* Display serif for hero headings (z.ai aesthetic). */
    serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  },
  radius: {
    block: 8,
    card: 14,
    pill: 9999,
  },
} as const;

export type Tokens = typeof tokens;

/** Structural widening of {@link Tokens} — same keys, plain `string` /
 *  `number` leaves — so alternate palettes (dark) can hold different values
 *  while staying shape-compatible with everything that reads `tokens`. */
type Widen<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends number ? number : Widen<T[K]>;
};
export type ThemeTokens = Widen<Tokens>;

/**
 * The DESIGNED dark palette — not a naive inversion. Lightness ordering
 * (darkest → lightest): sidebar rail < app canvas < main column < cards <
 * resting surfaces, mirroring the light theme's "columns register against
 * each other" intent. The brand accents (pink / cyan / purple / status
 * colors) and gradients survive dark unchanged; text flips to light
 * grays in the same cool-indigo family; shadows go near-black at higher
 * alpha because rgba(15,23,42,…) ink reads as nothing on a dark canvas.
 *
 * Shape-frozen against {@link tokens} (same flat color keys) — mobile's
 * tailwind config and the CSS-var generator consume both interchangeably.
 */
export const darkTokens: ThemeTokens = {
  color: {
    /* z.ai-style neutral dark: near-black canvas, dark-grey columns/cards,
     * light text. Lightness ordering preserved: sidebar < canvas < main <
     * card < surface. Pink accent kept. */
    appBg: '#0d0d0f',
    mainBg: '#161618',
    surface: '#222226',
    inputSoft: '#17171a' /* soft inputs recess below the card they sit on */,
    cardBg: '#1b1b1e',
    cardBorder: '#26262b',
    cardBorderStrong: '#3a3a40',
    text: '#e8e8ea',
    textMuted: '#a1a1aa',
    textDim: '#6e6e76',
    sidebarBg: '#0a0a0c',
    sidebarBgHover: '#19191c',
    sidebarBgActive: '#26262b' /* neutral grey active row */,
    sidebarText: '#e8e8ea',
    sidebarTextDim: '#8a8a92',
    sidebarBorder: '#222226',
    primary: tokens.color.primary,
    primaryStrong: tokens.color.primaryStrong,
    primarySoft: '#2b1622' /* the near-white pink-50 flips to the dark plum wash */,
    send: tokens.color.send,
    accent: tokens.color.accent,
    accentStrong: tokens.color.accentStrong,
    purple: tokens.color.purple,
    green: tokens.color.green,
    amber: tokens.color.amber,
    pink: tokens.color.pink,
    red: tokens.color.red,
    ink: '#e8eaf6' /* near-white ink for dark pills */,
  },
  shadow: {
    card: '0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 24px -18px rgba(0, 0, 0, 0.7)',
  },
  gradient: { ...tokens.gradient },
  font: { ...tokens.font },
  radius: { ...tokens.radius },
};
