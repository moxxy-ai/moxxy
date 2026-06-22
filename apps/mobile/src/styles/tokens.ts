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
