import { tokens, darkTokens } from '@moxxy/design-tokens';
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

/**
 * A flat, theme-aware color map. Every `sx('bg-…' | 'text-…' | 'border-…')`
 * utility resolves its color through {@link activePalette}, which the
 * ThemeProvider swaps when the user (or the system) flips between light and
 * dark. The base names mirror the shared `@moxxy/design-tokens` palette; the
 * extra "semantic" names (soft fills, accent tints, on-color text, shadows)
 * carry the values that used to be hard-coded light hex across the components,
 * so one palette switch re-skins the whole app.
 */
export type ColorName =
  | 'appBg'
  | 'mainBg'
  | 'surface'
  | 'inputSoft'
  | 'cardBg'
  | 'cardBorder'
  | 'cardBorderStrong'
  | 'text'
  | 'textMuted'
  | 'textDim'
  | 'muted'
  | 'dim'
  | 'sidebarBg'
  | 'sidebarBgHover'
  | 'sidebarBgActive'
  | 'sidebarText'
  | 'sidebarTextDim'
  | 'sidebarBorder'
  | 'primary'
  | 'primaryStrong'
  | 'primarySoft'
  | 'send'
  | 'accent'
  | 'accentStrong'
  | 'purple'
  | 'purpleStrong'
  | 'green'
  | 'greenStrong'
  | 'amber'
  | 'pink'
  | 'red'
  | 'white'
  | 'black'
  | 'transparent'
  | 'shadow'
  | 'overlay'
  | 'greenSoft'
  | 'greenBorder'
  | 'redSoft'
  | 'redTint'
  | 'redBorder'
  | 'redText'
  | 'purpleSoft'
  | 'purpleBorder'
  | 'amberSoft'
  | 'cyanSoft'
  | 'pinkText'
  | 'pinkBorder'
  | 'tint'
  | 'codeBg'
  | 'codeInline'
  | 'codeText'
  | 'glassFill'
  | 'glassHeavy'
  | 'glassBorder'
  | 'glassHighlight';

export type Palette = Record<ColorName, string>;

function buildPalette(c: Record<keyof typeof tokens.color, string>, extra: Partial<Palette>): Palette {
  return {
    appBg: c.appBg,
    mainBg: c.mainBg,
    surface: c.surface,
    inputSoft: c.inputSoft,
    cardBg: c.cardBg,
    cardBorder: c.cardBorder,
    cardBorderStrong: c.cardBorderStrong,
    text: c.text,
    textMuted: c.textMuted,
    textDim: c.textDim,
    muted: c.textMuted,
    dim: c.textDim,
    sidebarBg: c.sidebarBg,
    sidebarBgHover: c.sidebarBgHover,
    sidebarBgActive: c.sidebarBgActive,
    sidebarText: c.sidebarText,
    sidebarTextDim: c.sidebarTextDim,
    sidebarBorder: c.sidebarBorder,
    primary: c.primary,
    primaryStrong: c.primaryStrong,
    primarySoft: c.primarySoft,
    send: c.send,
    accent: c.accent,
    accentStrong: c.accentStrong,
    purple: c.purple,
    green: c.green,
    amber: c.amber,
    pink: c.pink,
    red: c.red,
    white: '#ffffff',
    black: '#000000',
    transparent: 'transparent',
    // The remaining (semantic) names are theme-specific; supplied via `extra`.
    purpleStrong: '#7c3aed',
    greenStrong: '#16a34a',
    shadow: '#0f172a',
    overlay: 'rgba(15, 23, 42, 0.48)',
    greenSoft: '#ecfdf5',
    greenBorder: '#bbf7d0',
    redSoft: '#fef2f2',
    redTint: '#fee2e2',
    redBorder: '#fecaca',
    redText: '#991b1b',
    purpleSoft: '#f5f3ff',
    purpleBorder: '#c7d2fe',
    amberSoft: '#fffbeb',
    cyanSoft: '#ecfeff',
    pinkText: '#be185d',
    pinkBorder: '#f9a8d4',
    tint: '#f8fafc',
    codeBg: '#f8fafc',
    codeInline: '#eef2ff',
    codeText: '#334155',
    glassFill: 'rgba(255, 255, 255, 0.7)',
    glassHeavy: 'rgba(248, 249, 253, 0.82)',
    glassBorder: 'rgba(15, 23, 42, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.7)',
    ...extra,
  };
}

export const lightPalette: Palette = buildPalette(tokens.color, {});

export const darkPalette: Palette = buildPalette(darkTokens.color, {
  purpleStrong: '#a78bfa',
  greenStrong: '#34d399',
  shadow: '#000000',
  overlay: 'rgba(0, 0, 0, 0.62)',
  greenSoft: '#0f2a22',
  greenBorder: '#1f5f47',
  redSoft: '#2a1620',
  redTint: '#3a1820',
  redBorder: '#5b2330',
  redText: '#fca5a5',
  purpleSoft: '#1e1b3a',
  purpleBorder: '#3b3470',
  amberSoft: '#2a2210',
  cyanSoft: '#0c2630',
  pinkText: '#f9a8d4',
  pinkBorder: '#5e2945',
  tint: '#121420',
  codeBg: '#121420',
  codeInline: '#1e2233',
  codeText: '#c7cbe6',
  glassFill: 'rgba(28, 31, 46, 0.55)',
  glassHeavy: 'rgba(16, 17, 23, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
  glassHighlight: 'rgba(255, 255, 255, 0.06)',
});

export const palettes = { light: lightPalette, dark: darkPalette } as const;
export type ThemeScheme = keyof typeof palettes;

/** The palette every render-time `sx()` color resolves against. Dark by
 *  default; the ThemeProvider rewrites it when the resolved scheme changes,
 *  then re-renders the screen roots (AppShell / ScreenFrame subscribe to the
 *  theme context) so descendant `sx()` calls re-read it. */
let activePalette: Palette = darkPalette;

export function setActivePalette(scheme: ThemeScheme): void {
  activePalette = palettes[scheme];
}

export function getActivePalette(): Palette {
  return activePalette;
}

export const mobileShadows = StyleSheet.create({
  card: {
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.32,
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
        shadowOpacity: 0.18,
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
  'self-center': { alignSelf: 'center' },
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
  'rounded-3xl': { borderRadius: 26 },
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

function resolveColorUtility(token: string): AnyStyle | undefined {
  const colorMatch = /^(bg|text|border)-([A-Za-z]+)(?:\/(\d+))?$/.exec(token);
  if (!colorMatch) return undefined;
  const [, target, name, opacity] = colorMatch;
  const value = activePalette[name as ColorName];
  if (value === undefined) return undefined;
  const finalColor = opacity ? alphaColor(value, Number(opacity) / 100) : value;
  if (target === 'bg') return { backgroundColor: finalColor };
  if (target === 'text') return { color: finalColor };
  return { borderColor: finalColor };
}

function parseUtility(token: string): AnyStyle | undefined {
  const known = baseUtilities[token] ?? sizeUtilities[token];
  if (known) return known;

  const colorUtility = resolveColorUtility(token);
  if (colorUtility) return colorUtility;

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
