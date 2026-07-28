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
    appBg: '#f1f2f9',
    /* Main chat column — a hair off pure white so it reads as separate
     * from adjacent white surfaces without being grey. */
    mainBg: 'rgb(252, 252, 255)',
    /* Resting surface for buttons / chips / inputs that sit ON a card
     * or column (the things that were hard-coded `#fff`). */
    surface: '#ffffff',
    /* Recessed "soft" input fill — a cool near-white a step below the
     * surface (TextInput/TextArea tone='soft', modal fields). */
    inputSoft: '#f7f8fc',
    cardBg: '#ffffff',
    cardBorder: '#e3e5f0',
    cardBorderStrong: '#cdd1e3',
    text: '#0f172a',
    textMuted: '#475569',
    textDim: '#7f8da4' /* darkened from #94a3b8, which was 2.56:1 on white: below the 3:1 large-text floor */,
    sidebarBg: '#ffffff',
    sidebarBgHover: '#f4f5fb',
    sidebarBgActive: '#eef2f7',
    sidebarText: '#0f172a',
    sidebarTextDim: '#6b7194',
    sidebarBorder: '#e3e5f0',
    primary: '#2f5d8f',
    primaryStrong: '#24486e',
    primarySoft: '#eef2f7',
    send: '#2f5d8f',
    accent: '#3f7f92',
    accentStrong: '#2f6577',
    purple: '#6b6f9c',
    green: '#2f855a',
    amber: '#b7791f',
    pink: '#2f5d8f',
    red: '#c53030',
  },
  shadow: {
    card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 24px -18px rgba(15, 23, 42, 0.10)',
  },
  gradient: {
    user: 'linear-gradient(135deg, #2f5d8f 0%, #4a7bb0 100%)',
    cta: 'linear-gradient(135deg, #2f5d8f 0%, #24486e 100%)',
    accent: 'linear-gradient(135deg, #4a7bb0 0%, #3f7f92 100%)',
  },
  font: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
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
    appBg: '#0b0c13',
    mainBg: '#101117',
    surface: '#1b1e2b',
    inputSoft: '#121420' /* soft inputs recess below the card they sit on */,
    cardBg: '#161823',
    cardBorder: '#262a3c',
    cardBorderStrong: '#363c54',
    text: '#e8eaf6',
    textMuted: '#a4abc8',
    textDim: '#697091',
    sidebarBg: '#0d0e16',
    sidebarBgHover: '#171927',
    sidebarBgActive: '#1b2430' /* cool slate wash for the active row on dark */,
    sidebarText: '#e8eaf6',
    sidebarTextDim: '#8b91b0',
    sidebarBorder: '#1f2233',
    /* Accents no longer survive dark unchanged. The light palette's primary is
     * a DEEP blue chosen to carry white text on a near-white surface; the same
     * ink on a near-black canvas is close to invisible. Each accent therefore
     * has an explicit dark counterpart lifted into the readable range, which is
     * why these are literals rather than `tokens.color.*` references. */
    primary: '#6f9ecf',
    primaryStrong: '#8fb6df',
    primarySoft: '#1b2430',
    send: '#6f9ecf',
    accent: '#78a9b8',
    accentStrong: '#8fbecb',
    purple: '#9298c4',
    green: '#5aa87c',
    amber: '#c99a45',
    pink: '#6f9ecf',
    red: '#d97070',
  },
  shadow: {
    card: '0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 24px -18px rgba(0, 0, 0, 0.7)',
  },
  gradient: { ...tokens.gradient },
  font: { ...tokens.font },
  radius: { ...tokens.radius },
};
