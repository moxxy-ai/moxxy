import { tokens } from '@moxxy/design-tokens';
import { Platform, StyleSheet } from 'react-native';
import type { ImageStyle, StyleProp, TextStyle, ViewStyle } from 'react-native';

type AnyStyle = ViewStyle | TextStyle | ImageStyle;
type StyleInput =
  | string
  | StyleProp<AnyStyle>
  | false
  | null
  | undefined
  | readonly StyleInput[];

const color = tokens.color;

export const mobileTheme = {
  color: {
    appBg: color.appBg,
    mainBg: color.mainBg,
    surface: color.surface,
    inputSoft: color.inputSoft,
    cardBg: color.cardBg,
    cardBorder: color.cardBorder,
    cardBorderStrong: color.cardBorderStrong,
    text: color.text,
    textMuted: color.textMuted,
    textDim: color.textDim,
    sidebarBg: color.sidebarBg,
    sidebarBgHover: color.sidebarBgHover,
    sidebarBgActive: color.sidebarBgActive,
    sidebarText: color.sidebarText,
    sidebarTextDim: color.sidebarTextDim,
    sidebarBorder: color.sidebarBorder,
    primary: color.primary,
    primaryStrong: color.primaryStrong,
    primarySoft: color.primarySoft,
    send: color.send,
    accent: color.accent,
    accentStrong: color.accentStrong,
    purple: color.purple,
    green: color.green,
    amber: color.amber,
    pink: color.pink,
    red: color.red,
    transparent: 'transparent',
    white: '#ffffff',
    black: '#000000',
  },
  radius: {
    block: tokens.radius.block,
    card: tokens.radius.card,
    pill: tokens.radius.pill,
  },
  spacing: {
    0: 0,
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
    11: 44,
    12: 48,
    14: 56,
    16: 64,
    20: 80,
    24: 96,
  },
  typography: {
    xs: 11,
    sm: 13,
    base: 16,
    lg: 18,
    xl: 20,
    title: 28,
  },
  touchTarget: {
    min: 44,
    compact: 36,
  },
} as const;

export const mobileShadows = StyleSheet.create({
  card: {
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  soft: {
    ...Platform.select({
      ios: {
        shadowColor: color.primary,
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
      },
      android: {
        elevation: 2,
      },
      default: {},
    }),
  },
});

export const mobileStyleSpecs = {
  card: {
    backgroundColor: mobileTheme.color.cardBg,
    borderColor: mobileTheme.color.cardBorder,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
  } satisfies ViewStyle,
  pill: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    justifyContent: 'center',
  } satisfies ViewStyle,
  input: {
    backgroundColor: mobileTheme.color.inputSoft,
    borderColor: mobileTheme.color.cardBorder,
    borderRadius: mobileTheme.radius.card,
    borderWidth: 1,
    color: mobileTheme.color.text,
  } satisfies TextStyle,
};

export const mobileStyles = StyleSheet.create({
  card: mobileStyleSpecs.card,
  pill: mobileStyleSpecs.pill,
  input: mobileStyleSpecs.input,
});

const namedColors = {
  appBg: mobileTheme.color.appBg,
  mainBg: mobileTheme.color.mainBg,
  surface: mobileTheme.color.surface,
  inputSoft: mobileTheme.color.inputSoft,
  cardBg: mobileTheme.color.cardBg,
  cardBorder: mobileTheme.color.cardBorder,
  cardBorderStrong: mobileTheme.color.cardBorderStrong,
  text: mobileTheme.color.text,
  muted: mobileTheme.color.textMuted,
  dim: mobileTheme.color.textDim,
  textMuted: mobileTheme.color.textMuted,
  textDim: mobileTheme.color.textDim,
  primary: mobileTheme.color.primary,
  primaryStrong: mobileTheme.color.primaryStrong,
  primarySoft: mobileTheme.color.primarySoft,
  send: mobileTheme.color.send,
  accent: mobileTheme.color.accent,
  accentStrong: mobileTheme.color.accentStrong,
  purple: mobileTheme.color.purple,
  green: mobileTheme.color.green,
  amber: mobileTheme.color.amber,
  pink: mobileTheme.color.pink,
  red: mobileTheme.color.red,
  white: mobileTheme.color.white,
  black: mobileTheme.color.black,
  transparent: mobileTheme.color.transparent,
} as const;

const spacing = mobileTheme.spacing;

function alphaColor(base: string, alpha: number): string {
  if (!base.startsWith('#') || (base.length !== 7 && base.length !== 4)) {
    return base;
  }
  const full =
    base.length === 4
      ? `#${base[1]}${base[1]}${base[2]}${base[2]}${base[3]}${base[3]}`
      : base;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${full}${value}`;
}

const baseUtilities: Record<string, AnyStyle> = {
  absolute: { position: 'absolute' },
  relative: { position: 'relative' },
  hidden: { display: 'none' },
  'overflow-hidden': { overflow: 'hidden' },
  'flex-1': { flex: 1 },
  'flex-row': { flexDirection: 'row' },
  'flex-col': { flexDirection: 'column' },
  'flex-wrap': { flexWrap: 'wrap' },
  'items-center': { alignItems: 'center' },
  'items-start': { alignItems: 'flex-start' },
  'items-end': { alignItems: 'flex-end' },
  'justify-center': { justifyContent: 'center' },
  'justify-between': { justifyContent: 'space-between' },
  'justify-end': { justifyContent: 'flex-end' },
  'self-start': { alignSelf: 'flex-start' },
  'self-end': { alignSelf: 'flex-end' },
  'self-stretch': { alignSelf: 'stretch' },
  'min-w-0': { minWidth: 0 },
  'opacity-50': { opacity: 0.5 },
  'opacity-60': { opacity: 0.6 },
  'opacity-70': { opacity: 0.7 },
  'opacity-80': { opacity: 0.8 },
  'opacity-90': { opacity: 0.9 },
  'text-left': { textAlign: 'left' },
  'text-center': { textAlign: 'center' },
  'text-right': { textAlign: 'right' },
  uppercase: { textTransform: 'uppercase' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  'font-normal': { fontWeight: '400' },
  'font-medium': { fontWeight: '500' },
  'font-semibold': { fontWeight: '600' },
  'font-bold': { fontWeight: '700' },
  'font-extrabold': { fontWeight: '800' },
  'font-black': { fontWeight: '900' },
  'text-xs': { fontSize: mobileTheme.typography.xs },
  'text-sm': { fontSize: mobileTheme.typography.sm },
  'text-base': { fontSize: mobileTheme.typography.base },
  'text-lg': { fontSize: mobileTheme.typography.lg },
  'text-xl': { fontSize: mobileTheme.typography.xl },
  'leading-4': { lineHeight: 16 },
  'leading-5': { lineHeight: 20 },
  'leading-6': { lineHeight: 24 },
  'leading-7': { lineHeight: 28 },
  'tracking-wide': { letterSpacing: 0.4 },
  'tracking-widest': { letterSpacing: 1.2 },
  'tabular-nums': { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
  'rounded-block': { borderRadius: mobileTheme.radius.block },
  'rounded-card': { borderRadius: mobileTheme.radius.card },
  'rounded-pill': { borderRadius: mobileTheme.radius.pill },
  rounded: { borderRadius: mobileTheme.radius.block },
  'rounded-lg': { borderRadius: 12 },
  'rounded-xl': { borderRadius: 16 },
  'rounded-2xl': { borderRadius: 20 },
  'rounded-full': { borderRadius: mobileTheme.radius.pill },
  border: { borderWidth: 1 },
  'border-0': { borderWidth: 0 },
  'border-t': { borderTopWidth: 1 },
  'border-b': { borderBottomWidth: 1 },
  'shadow-card': mobileShadows.card,
  'shadow-soft': mobileShadows.soft,
};

const sizeUtilities: Record<string, AnyStyle> = {};
for (const [key, value] of Object.entries(spacing)) {
  sizeUtilities[`p-${key}`] = { padding: value };
  sizeUtilities[`px-${key}`] = { paddingHorizontal: value };
  sizeUtilities[`py-${key}`] = { paddingVertical: value };
  sizeUtilities[`pt-${key}`] = { paddingTop: value };
  sizeUtilities[`pr-${key}`] = { paddingRight: value };
  sizeUtilities[`pb-${key}`] = { paddingBottom: value };
  sizeUtilities[`pl-${key}`] = { paddingLeft: value };
  sizeUtilities[`m-${key}`] = { margin: value };
  sizeUtilities[`mx-${key}`] = { marginHorizontal: value };
  sizeUtilities[`my-${key}`] = { marginVertical: value };
  sizeUtilities[`mt-${key}`] = { marginTop: value };
  sizeUtilities[`mr-${key}`] = { marginRight: value };
  sizeUtilities[`mb-${key}`] = { marginBottom: value };
  sizeUtilities[`ml-${key}`] = { marginLeft: value };
  sizeUtilities[`gap-${key}`] = { gap: value };
  sizeUtilities[`h-${key}`] = { height: value };
  sizeUtilities[`w-${key}`] = { width: value };
  sizeUtilities[`min-h-${key}`] = { minHeight: value };
  sizeUtilities[`top-${key}`] = { top: value };
  sizeUtilities[`right-${key}`] = { right: value };
  sizeUtilities[`bottom-${key}`] = { bottom: value };
  sizeUtilities[`left-${key}`] = { left: value };
}

const colorUtilities: Record<string, AnyStyle> = {};
for (const [name, value] of Object.entries(namedColors)) {
  colorUtilities[`bg-${name}`] = { backgroundColor: value };
  colorUtilities[`text-${name}`] = { color: value };
  colorUtilities[`border-${name}`] = { borderColor: value };
}

function parseUtility(token: string): AnyStyle | undefined {
  const known = baseUtilities[token] ?? sizeUtilities[token] ?? colorUtilities[token];
  if (known) return known;

  const colorMatch = /^(bg|text|border)-([A-Za-z]+)(?:\/(\d+))?$/.exec(token);
  if (colorMatch) {
    const [, target, name, opacity] = colorMatch;
    const value = namedColors[name as keyof typeof namedColors];
    if (!value) return undefined;
    const finalColor = opacity ? alphaColor(value, Number(opacity) / 100) : value;
    if (target === 'bg') return { backgroundColor: finalColor };
    if (target === 'text') return { color: finalColor };
    return { borderColor: finalColor };
  }

  const numberMatch = /^(-?)(h|w|min-h|min-w|max-h|max-w|top|right|bottom|left)-\[(\d+)px\]$/.exec(token);
  if (numberMatch) {
    const [, negative, key, raw] = numberMatch;
    const value = Number(raw) * (negative ? -1 : 1);
    const map: Record<string, keyof ViewStyle> = {
      h: 'height',
      w: 'width',
      'min-h': 'minHeight',
      'min-w': 'minWidth',
      'max-h': 'maxHeight',
      'max-w': 'maxWidth',
      top: 'top',
      right: 'right',
      bottom: 'bottom',
      left: 'left',
    };
    return { [map[key]]: value } as ViewStyle;
  }

  const fontMatch = /^text-\[(\d+)px\]$/.exec(token);
  if (fontMatch) return { fontSize: Number(fontMatch[1]) };

  const lineHeightMatch = /^leading-\[(\d+)px\]$/.exec(token);
  if (lineHeightMatch) return { lineHeight: Number(lineHeightMatch[1]) };

  const zMatch = /^z-(\d+)$/.exec(token);
  if (zMatch) return { zIndex: Number(zMatch[1]) };

  return undefined;
}

function pushStyle(out: AnyStyle[], value: StyleInput): void {
  if (!value) return;
  if (typeof value === 'string') {
    for (const token of value.split(/\s+/)) {
      if (!token) continue;
      const parsed = parseUtility(token);
      if (parsed) out.push(parsed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pushStyle(out, item);
    return;
  }
  out.push(value as AnyStyle);
}

export function sx(...values: StyleInput[]): StyleProp<any> {
  const out: AnyStyle[] = [];
  for (const value of values) pushStyle(out, value);
  return out;
}

/* ============================================================================
 * Liquid-glass design language (2026) — an ADDITIVE layer on top of the shared
 * @moxxy/design-tokens palette. Nothing above is changed; these exports power
 * the GlassSurface / Gradient / motion primitives so the brand stays in lockstep
 * with desktop while mobile gains depth, translucency and life. Pure values —
 * no new native dependencies. If `expo-blur` is ever added, only GlassSurface
 * needs to change; every consumer keeps working.
 * ========================================================================== */

/** Motion grammar. Durations in ms; spring presets feed `Animated.spring`.
 *  Functional, iOS-like motion — quick in, soft settle, never jelly. */
export const mobileMotion = {
  duration: {
    instant: 90,
    fast: 150,
    base: 240,
    slow: 340,
    slower: 460,
  },
  spring: {
    /** Button / chip press — snappy and tight. */
    press: { tension: 320, friction: 18 },
    /** Cards & sheets settling into place. */
    gentle: { tension: 170, friction: 22 },
    /** Playful accents (badges, send pop). */
    bouncy: { tension: 210, friction: 13 },
  },
  scale: {
    press: 0.965,
    pressSmall: 0.93,
    pressLarge: 0.98,
  },
} as const;

type Elevation = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

/** A tuned depth ramp. Ink shadows (cool slate) for resting surfaces; the brand
 *  glow tiers carry pink/cyan light for hero CTAs and focus. Use via
 *  `mobileElevation.md` etc. — Android falls back to `elevation`. */
export const mobileElevation: Record<
  'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'glow' | 'glowAccent',
  Elevation
> = {
  xs: { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  sm: { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 2 },
  md: { shadowColor: '#1e2540', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.09, shadowRadius: 22, elevation: 5 },
  lg: { shadowColor: '#1e2540', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.14, shadowRadius: 34, elevation: 10 },
  xl: { shadowColor: '#161b34', shadowOffset: { width: 0, height: 26 }, shadowOpacity: 0.2, shadowRadius: 46, elevation: 18 },
  glow: { shadowColor: tokens.color.primary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.34, shadowRadius: 22, elevation: 8 },
  glowAccent: { shadowColor: tokens.color.accentStrong, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 22, elevation: 8 },
};

type GlassSpec = {
  /** Resting fill (translucent — reads as frosted over the app canvas). */
  fill: string;
  /** Outer hairline border. */
  border: string;
  /** Brighter top-edge specular line — the "lensing" cue of liquid glass. */
  hairline: string;
  /** Inner sheen overlay laid over the top third. */
  sheen: string;
};

/** Glass material variants. `chrome` stays near-opaque (sits over scrolling
 *  content, must not bleed text through); `card`/`sheet`/`subtle` are airier and
 *  sit over the static canvas. `brand`/`accent` carry a tinted wash. */
export const mobileGlass: Record<
  'chrome' | 'card' | 'sheet' | 'subtle' | 'brand' | 'accent',
  GlassSpec
> = {
  chrome: {
    // Sits over scrolling content with no real backdrop blur, so it stays
    // near-opaque to avoid sharp text ghosting — the glass read comes from the
    // hairline + sheen + ambient shadow, not see-through.
    fill: 'rgba(252,252,255,0.93)',
    border: 'rgba(226,228,240,0.9)',
    hairline: 'rgba(255,255,255,0.95)',
    sheen: 'rgba(255,255,255,0.55)',
  },
  card: {
    fill: 'rgba(255,255,255,0.82)',
    border: 'rgba(255,255,255,0.7)',
    hairline: 'rgba(255,255,255,0.92)',
    sheen: 'rgba(255,255,255,0.5)',
  },
  sheet: {
    fill: 'rgba(252,252,255,0.9)',
    border: 'rgba(224,227,240,0.85)',
    hairline: 'rgba(255,255,255,0.96)',
    sheen: 'rgba(255,255,255,0.6)',
  },
  subtle: {
    fill: 'rgba(247,248,252,0.7)',
    border: 'rgba(227,229,240,0.7)',
    hairline: 'rgba(255,255,255,0.8)',
    sheen: 'rgba(255,255,255,0.4)',
  },
  brand: {
    fill: 'rgba(253,242,248,0.86)',
    border: 'rgba(249,168,212,0.55)',
    hairline: 'rgba(255,255,255,0.9)',
    sheen: 'rgba(255,255,255,0.5)',
  },
  accent: {
    fill: 'rgba(236,254,255,0.84)',
    border: 'rgba(103,232,249,0.5)',
    hairline: 'rgba(255,255,255,0.9)',
    sheen: 'rgba(255,255,255,0.5)',
  },
};

export type GradientStop = { offset: number; color: string };

/** Brand gradients as SVG-consumable stop arrays — the exact desktop ramps
 *  (`tokens.gradient`) translated for the `<Gradient>` primitive. 135° default. */
export const mobileGradients: Record<
  'brand' | 'cta' | 'accent' | 'user' | 'violet' | 'sunset' | 'mesh',
  GradientStop[]
> = {
  brand: [
    { offset: 0, color: '#f472b6' },
    { offset: 1, color: '#db2777' },
  ],
  cta: [
    { offset: 0, color: '#ec4899' },
    { offset: 1, color: '#db2777' },
  ],
  accent: [
    { offset: 0, color: '#38bdf8' },
    { offset: 1, color: '#22d3ee' },
  ],
  user: [
    { offset: 0, color: '#ec4899' },
    { offset: 1, color: '#e0418f' },
  ],
  violet: [
    { offset: 0, color: '#a78bfa' },
    { offset: 1, color: '#8b5cf6' },
  ],
  sunset: [
    { offset: 0, color: '#fb7185' },
    { offset: 0.5, color: '#ec4899' },
    { offset: 1, color: '#a855f7' },
  ],
  mesh: [
    { offset: 0, color: '#fdf2f8' },
    { offset: 0.55, color: '#f1f2f9' },
    { offset: 1, color: '#ecfeff' },
  ],
};

/** Accessibility-tuned ink. The shared `textDim` (#94a3b8) fails WCAG AA for
 *  text on white (~2.6:1); use `inkMuted` for any text that must be *read*, and
 *  reserve `textDim` for decorative glyphs / placeholders. */
export const mobileInk = {
  strong: tokens.color.text, // #0f172a
  muted: tokens.color.textMuted, // #475569 — AA+ on white
  soft: '#64748b', // ~5.0:1 — captions / secondary
  faint: tokens.color.textDim, // decorative only
  onBrand: '#ffffff',
} as const;

/* ============================================================================
 * Refined-minimal surface system (2026 rebuild). A quiet, editorial light
 * theme: a soft neutral canvas, white cards separated by HAIRLINES rather than
 * shadow or gradient, and brand pink used sparingly — the send button, active
 * selection, links and the single primary CTA per screen. No gradients, almost
 * no shadow. This supersedes the glass/gradient layer above for redesigned
 * components.
 * ========================================================================== */
export const mobileSurface = {
  /** Page canvas — a hair of cool grey so white cards read as raised. */
  appBg: '#f5f6f9',
  /** Card / sheet fill. */
  card: '#ffffff',
  /** Recessed input / field fill. */
  field: '#f3f4f8',
  /** Hairline border around cards & controls. */
  border: '#e7e9f0',
  /** A slightly stronger hairline for inputs / emphasis. */
  borderStrong: '#dadde7',
  /** Row divider inside grouped cards. */
  divider: '#eef0f5',
  /** The one accent — pink — and its quiet tints. */
  accent: '#ec4899',
  accentStrong: '#db2777',
  accentSoft: '#fdf2f8',
  accentBorder: '#f6cfe3',
} as const;

/** Near-flat depth. Hairlines do the separation; shadow is a whisper, reserved
 *  for genuinely floating chrome (composer, sheets, FABs). */
export const mobileFlat = {
  none: {} as Record<string, never>,
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  floating: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 8,
  },
} as const;
