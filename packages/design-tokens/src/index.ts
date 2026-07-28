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
    /* Neutral paper, not tinted: the brand ground is white, and a lavender
     * canvas fights Signal's warmth. */
    appBg: '#f4f4f7',
    /* Main chat column — pure paper, so the column reads as the sheet and the
     * canvas around it as the desk. */
    mainBg: '#ffffff',
    /* Resting surface for buttons / chips / inputs that sit ON a card
     * or column (the things that were hard-coded `#fff`). */
    surface: '#ffffff',
    /* Recessed "soft" input fill — a step below the surface
     * (TextInput/TextArea tone='soft', modal fields). */
    inputSoft: '#f4f4f7',
    cardBg: '#ffffff',
    cardBorder: '#e4e4ea',
    cardBorderStrong: '#d3d4dc',
    /* Ink, straight from assets/brand/README.md. */
    text: '#0b0d12',
    textMuted: '#55596b',
    textDim: '#8a8f9f',
    sidebarBg: '#ffffff',
    sidebarBgHover: '#f4f4f7',
    /* The active row carries a Signal wash. */
    sidebarBgActive: '#fff1ec',
    sidebarText: '#0b0d12',
    sidebarTextDim: '#6e7383',
    sidebarBorder: '#e4e4ea',
    /* Signal, one accent, used only where the eye is meant to go. Interactive
     * fills take the deeper stop: flat Signal carries white body text at only
     * 3.36:1, and a CTA label is the one place that cannot be borderline. */
    primary: '#c4310f',
    primaryStrong: '#9c2409',
    primarySoft: '#fff1ec',
    send: '#c4310f',
    /* The secondary accent stays in Signal's family instead of introducing the
     * cyan the old palette paired with pink. */
    accent: '#e2551f',
    accentStrong: '#c4310f',
    /* Categorical and semantic hues are not brand: a workflow step kind is
     * identified by its hue, and green/amber/red mean success/attention/error.
     * They keep the toned values #478 gave them; only the pink alias, which was
     * never categorical, follows the accent. */
    purple: '#6b6f9c',
    green: '#2f855a',
    amber: '#b7791f',
    pink: '#c4310f',
    red: '#c53030',
  },
  shadow: {
    /* Ink-tinted and shallow. Structure comes from hairlines, not elevation. */
    card: '0 1px 2px rgba(11, 13, 18, 0.04), 0 10px 24px -18px rgba(11, 13, 18, 0.10)',
  },
  gradient: {
    user: 'linear-gradient(135deg, #c4310f 0%, #e2551f 100%)',
    /* A CTA gradient carries white too, so it stays inside the deep stops. */
    cta: 'linear-gradient(135deg, #d13d14 0%, #c4310f 55%, #9c2409 100%)',
    accent: 'linear-gradient(135deg, #e2551f 0%, #c4310f 100%)',
  },
  font: {
    /* Space Grotesk carries headings, echoing the constructed wordmark. */
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  },
  radius: {
    /* Tighter geometry, matching the site's near-square corners. */
    block: 6,
    card: 10,
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
 * each other" intent. Every accent has an explicit dark counterpart (a fill
 * chosen to carry white on paper is close to invisible on ink); text flips to
 * light greys in the same Ink family; shadows go near-black at higher alpha
 * because rgba(11,13,18,…) ink reads as nothing on a dark canvas.
 *
 * Shape-frozen against {@link tokens} (same flat color keys) — mobile's
 * tailwind config and the CSS-var generator consume both interchangeably.
 */
export const darkTokens: ThemeTokens = {
  color: {
    /* Ink is the ground. The rail sits below the canvas, the canvas below the
     * column, exactly as in light. */
    appBg: '#08090d',
    mainBg: '#0b0d12',
    surface: '#1a1e28',
    inputSoft: '#0f1219' /* soft inputs recess below the card they sit on */,
    cardBg: '#12151d',
    cardBorder: '#232833',
    cardBorderStrong: '#333947',
    text: '#edeef2',
    textMuted: '#9096a6',
    textDim: '#6b7284',
    sidebarBg: '#08090d',
    sidebarBgHover: '#14171f',
    sidebarBgActive: '#2e1409' /* the Signal wash, at ink lightness */,
    sidebarText: '#edeef2',
    sidebarTextDim: '#868da0',
    sidebarBorder: '#1c202a',
    /* Accents do not survive dark unchanged. Light's interactive Signal is the
     * DEEP stop, chosen to carry white on a near-white surface; that same ink
     * on a near-black canvas is close to invisible. On ink the accent lifts to
     * flat Signal and above, which is what the mark's own strand does, so these
     * stay literals rather than `tokens.color.*` references. */
    primary: '#ff6a44',
    primaryStrong: '#ff4a1e',
    primarySoft: '#2e1409',
    send: '#ff6a44',
    accent: '#ff9a5e',
    accentStrong: '#ff6a44',
    /* Semantic and categorical hues keep their explicit dark counterparts. */
    purple: '#9298c4',
    green: '#5aa87c',
    amber: '#c99a45',
    pink: '#ff6a44',
    red: '#d97070',
  },
  shadow: {
    card: '0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 24px -18px rgba(0, 0, 0, 0.7)',
  },
  gradient: {
    user: 'linear-gradient(135deg, #ff6a44 0%, #ff9a5e 100%)',
    cta: 'linear-gradient(135deg, #ff9a5e 0%, #ff6a44 55%, #ff4a1e 100%)',
    accent: 'linear-gradient(135deg, #ff9a5e 0%, #ff6a44 100%)',
  },
  font: { ...tokens.font },
  radius: { ...tokens.radius },
};
