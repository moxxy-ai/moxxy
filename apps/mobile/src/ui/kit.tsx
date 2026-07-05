import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { MobileIcon, type MobileIconName } from '../components/MobileIcon';

/* -------------------------------------------------------------- BottomSheet */

/** The shared draggable, glass bottom-sheet used for every action surface
 *  (composer options, model/mode, goal, compact, rename) so nothing renders as
 *  a plain modal. Drag the grabber down to dismiss. */
export function BottomSheet({
  open,
  onClose,
  title,
  avoidKeyboard = false,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly avoidKeyboard?: boolean;
  readonly children: ReactNode;
}) {
  const { colors } = useTheme();
  const [rendered, setRendered] = useState(open);
  const translateY = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const heightRef = useRef(360);

  // translateY runs on the JS driver so the grabber pan can `setValue` it live
  // and track the finger; opacity stays on the native driver.
  useEffect(() => {
    if (open) {
      setRendered(true);
      translateY.setValue(heightRef.current);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, bounciness: 3, speed: 14, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: heightRef.current, duration: 200, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [open]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 3,
      onPanResponderMove: (_e, g) => {
        translateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 0.6) onClose();
        else Animated.spring(translateY, { toValue: 0, bounciness: 4, speed: 16, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    if (e.nativeEvent.layout.height > 0) heightRef.current = e.nativeEvent.layout.height;
  };

  if (!rendered) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={avoidKeyboard && Platform.OS === 'ios' ? 'padding' : undefined}
        style={sx('flex-1', { justifyContent: 'flex-end' })}
      >
        <Animated.View style={[{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }, { opacity: progress }]}>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={sx('flex-1', { backgroundColor: colors.overlay })} />
        </Animated.View>
        <Animated.View onLayout={onLayout} style={{ transform: [{ translateY }] }}>
          <Glass radius={28} intensity={80} heavy>
            <SafeAreaView edges={['bottom']}>
              <View {...pan.panHandlers} style={sx('items-center', { paddingBottom: 10, paddingTop: 12 })}>
                <View style={sx('rounded-full', { backgroundColor: colors.textDim, height: 5, opacity: 0.6, width: 44 })} />
              </View>
              {title ? <Text style={sx('px-5 pb-2 text-[20px] font-black text-text', { letterSpacing: -0.3 })}>{title}</Text> : null}
              <View>{children}</View>
            </SafeAreaView>
          </Glass>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ----------------------------------------------------------- Sheet list rows */

/** A grouped, rounded container for SheetRows — the single list style reused
 *  across every sheet page (options, model, mode, actions). */
export function SheetGroup({ children, style }: { readonly children: ReactNode; readonly style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[sx('overflow-hidden rounded-2xl', { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: 1 }), style]}>
      {children}
    </View>
  );
}

/** One row inside a SheetGroup. Handles the leading icon/dot, label + optional
 *  sublabel, a trailing value, and a trailing affordance (chevron / expand
 *  chevron / check / custom). `selected` tints the row with the accent. */
export function SheetRow({
  icon,
  iconTone = 'neutral',
  dot,
  label,
  sublabel,
  value,
  selected = false,
  accent,
  indent = false,
  divider = false,
  chevron = false,
  expanded,
  check = false,
  trailing,
  onPress,
  disabled = false,
}: {
  readonly icon?: MobileIconName;
  readonly iconTone?: Tone;
  readonly dot?: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly value?: string;
  readonly selected?: boolean;
  readonly accent?: string;
  readonly indent?: boolean;
  readonly divider?: boolean;
  readonly chevron?: boolean;
  readonly expanded?: boolean;
  readonly check?: boolean;
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
}) {
  const { colors } = useTheme();
  const accentColor = accent ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) =>
        sx('flex-row items-center', {
          backgroundColor: selected ? colors.primarySoft : pressed ? colors.glassHighlight : 'transparent',
          borderTopColor: colors.cardBorder,
          borderTopWidth: divider ? 1 : 0,
          gap: 12,
          minHeight: sublabel ? 64 : 56,
          opacity: disabled ? 0.45 : 1,
          paddingLeft: indent ? 32 : 14,
          paddingRight: 14,
          paddingVertical: sublabel ? 10 : 0,
        })
      }
    >
      {icon ? <IconBadge icon={icon} tone={iconTone} size={32} /> : null}
      {dot ? <View style={sx('rounded-full', { backgroundColor: dot, height: 8, width: 8 })} /> : null}
      <View style={sx('flex-1', { minWidth: 0 })}>
        <Text style={sx('text-[15px] font-semibold', { color: selected ? accentColor : colors.text })} numberOfLines={1}>{label}</Text>
        {sublabel ? <Text style={sx('mt-0.5 text-[12px] font-medium text-dim', { lineHeight: 16 })} numberOfLines={2}>{sublabel}</Text> : null}
      </View>
      {value ? <Text style={sx('text-[14px] font-semibold text-muted', { flexShrink: 1, maxWidth: '42%', textAlign: 'right' })} numberOfLines={1}>{value}</Text> : null}
      {trailing}
      {check ? <MobileIcon name="check" size={18} strokeWidth={2.6} color={accentColor} /> : null}
      {expanded !== undefined ? (
        <MobileIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} strokeWidth={2.4} color={expanded ? accentColor : colors.textDim} />
      ) : chevron ? (
        <MobileIcon name="chevronRight" size={16} strokeWidth={2.4} color={colors.textDim} />
      ) : null}
    </Pressable>
  );
}

/** A glassmorphism (iOS-26 style) on/off toggle — a frosted blur track that
 *  fills with the brand tint when on, and a floating frosted thumb. Sized and
 *  centered predictably (the native iOS Switch breaks vertical centering). */
export function Toggle({ value, onValueChange, disabled = false }: { readonly value: boolean; readonly onValueChange: (value: boolean) => void; readonly disabled?: boolean }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [value, anim]);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 22] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Glass radius={15} intensity={24} style={{ borderColor: colors.glassBorder, borderWidth: 1, height: 30, justifyContent: 'center', overflow: 'hidden', width: 52 }}>
        <Animated.View pointerEvents="none" style={[StyleSheetAbsoluteFill, { backgroundColor: colors.primary, borderRadius: 15, opacity: anim }]} />
        <Animated.View style={[{ left: 3, position: 'absolute' }, { transform: [{ translateX }] }]}>
          <View
            style={sx('rounded-full', {
              backgroundColor: colors.white,
              elevation: 3,
              height: 24,
              shadowColor: '#000',
              shadowOffset: { height: 1, width: 0 },
              shadowOpacity: 0.25,
              shadowRadius: 2.5,
              width: 24,
            })}
          />
        </Animated.View>
      </Glass>
    </Pressable>
  );
}

/* ------------------------------------------------------------------- Glass */

/** iOS-26 "liquid glass" material — a translucent blur with a hairline light
 *  border and a faint inner highlight. Use for floating chrome (drawer,
 *  composer, headers) so content shows through. */
export function Glass({
  children,
  style,
  radius = 0,
  intensity = 60,
  heavy = false,
  borderColor,
  borderWidth = 1,
  fill,
}: {
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly radius?: number;
  readonly intensity?: number;
  readonly heavy?: boolean;
  readonly borderColor?: string;
  readonly borderWidth?: number;
  readonly fill?: string;
}) {
  const { colors, scheme } = useTheme();
  return (
    <BlurView
      intensity={intensity}
      tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      experimentalBlurMethod="dimezisBlurView"
      style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
    >
      <View
        style={[
          { backgroundColor: fill ?? (heavy ? colors.glassHeavy : colors.glassFill), borderColor: borderColor ?? colors.glassBorder, borderRadius: radius, borderWidth },
          StyleSheetAbsoluteFill,
        ]}
        pointerEvents="none"
      />
      {children}
    </BlurView>
  );
}

const StyleSheetAbsoluteFill = { bottom: 0, left: 0, position: 'absolute' as const, right: 0, top: 0 };

/** Vertical room a scrollable tab screen must leave so its last rows clear the
 *  floating bottom tab bar. */
export const TAB_BAR_CLEARANCE = 108;

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'info';

function toneColors(tone: Tone, colors: ReturnType<typeof useTheme>['colors']) {
  switch (tone) {
    case 'brand':
      return { fg: colors.primary, bg: colors.primarySoft };
    case 'success':
      return { fg: colors.greenStrong, bg: colors.greenSoft };
    case 'warn':
      return { fg: colors.amber, bg: colors.amberSoft };
    case 'danger':
      return { fg: colors.red, bg: colors.redSoft };
    case 'info':
      return { fg: colors.accentStrong, bg: colors.cyanSoft };
    default:
      return { fg: colors.textMuted, bg: colors.inputSoft };
  }
}

/* ------------------------------------------------------------------ Screen */

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top'],
  contentStyle,
  bottomClearance = TAB_BAR_CLEARANCE,
}: {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly padded?: boolean;
  readonly edges?: ReadonlyArray<Edge>;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly bottomClearance?: number;
}) {
  const { colors } = useTheme();
  const inner = padded ? { paddingHorizontal: 16 } : null;
  const body = scroll ? (
    <ScrollView
      style={sx('flex-1')}
      contentContainerStyle={[
        { paddingBottom: bottomClearance, paddingTop: 8 },
        inner,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[sx('flex-1'), { paddingTop: 8 }, inner, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={[sx('flex-1'), { backgroundColor: colors.appBg }]} edges={edges as Edge[]}>
      {body}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------ DetailHeader */

/** Header for a pushed (non-tab) screen: back chevron + title + optional right. */
export function DetailHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly right?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={sx('flex-row items-center border-b border-cardBorder px-2', {
        backgroundColor: colors.appBg,
        gap: 8,
        paddingBottom: 14,
        paddingTop: insets.top + 12,
      })}
    >
      <IconButton icon="chevronLeft" variant="ghost" accessibilityLabel="Go back" onPress={onBack} />
      <View style={sx('flex-1', { minWidth: 0 })}>
        <Text style={sx('text-[20px] font-black text-text', { letterSpacing: -0.3 })} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={sx('mt-0.5 text-[13px] font-medium text-dim')} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? <View style={sx('w-11')} />}
    </View>
  );
}

/* --------------------------------------------------------------- IconBadge */

export function IconBadge({
  icon,
  tone = 'brand',
  size = 38,
  color,
  bg,
}: {
  readonly icon: MobileIconName;
  readonly tone?: Tone;
  readonly size?: number;
  readonly color?: string;
  readonly bg?: string;
}) {
  const { colors } = useTheme();
  const t = toneColors(tone, colors);
  return (
    <View
      style={sx('items-center justify-center', {
        backgroundColor: bg ?? t.bg,
        borderRadius: size * 0.32,
        height: size,
        width: size,
      })}
    >
      <MobileIcon name={icon} size={size * 0.5} strokeWidth={2.3} color={color ?? t.fg} />
    </View>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  style,
  padded = true,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly padded?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        sx('rounded-2xl', {
          backgroundColor: colors.cardBg,
          borderColor: colors.cardBorder,
          borderWidth: 1,
        }),
        padded ? { padding: 16 } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------------------ SectionLabel */

export function SectionLabel({ children, style }: { readonly children: ReactNode; readonly style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[sx('text-[12px] font-black uppercase tracking-wide text-dim'), { marginBottom: 8, marginLeft: 4 }, style]}>
      {children}
    </Text>
  );
}

/* ----------------------------------------------------------------- Divider */

export function Divider({ inset = 0 }: { readonly inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ backgroundColor: colors.cardBorder, height: 1, marginLeft: inset }} />;
}

/* ------------------------------------------------------------------ Button */

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  full = true,
  size = 'lg',
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly icon?: MobileIconName;
  readonly disabled?: boolean;
  readonly full?: boolean;
  readonly size?: 'lg' | 'md';
}) {
  const { colors } = useTheme();
  const height = size === 'lg' ? 52 : 44;
  const palette = {
    primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.cardBorder },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
    danger: { bg: colors.redSoft, fg: colors.red, border: colors.redBorder },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) =>
        sx('flex-row items-center justify-center rounded-2xl', {
          alignSelf: full ? 'stretch' : 'flex-start',
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' || variant === 'danger' ? 1 : 0,
          gap: 8,
          height,
          opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
          paddingHorizontal: 18,
        })
      }
    >
      {icon ? <MobileIcon name={icon} size={18} strokeWidth={2.5} color={palette.fg} /> : null}
      <Text style={sx('text-[15px] font-bold', { color: palette.fg })}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------- IconButton */

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'surface',
  size = 44,
  color,
  disabled = false,
  badge = 0,
}: {
  readonly icon: MobileIconName;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  readonly variant?: 'surface' | 'ghost' | 'brand';
  readonly size?: number;
  readonly color?: string;
  readonly disabled?: boolean;
  readonly badge?: number;
}) {
  const { colors } = useTheme();
  const bg = variant === 'surface' ? colors.surface : variant === 'brand' ? colors.primarySoft : 'transparent';
  const border = variant === 'surface' ? colors.cardBorder : 'transparent';
  const fg = color ?? (variant === 'brand' ? colors.primary : colors.text);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={6}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) =>
        sx('items-center justify-center rounded-full', {
          backgroundColor: pressed ? colors.cardBg : bg,
          borderColor: border,
          borderWidth: variant === 'surface' ? 1 : 0,
          height: size,
          opacity: disabled ? 0.4 : 1,
          width: size,
        })
      }
    >
      <MobileIcon name={icon} size={size * 0.46} strokeWidth={2.4} color={fg} />
      {badge > 0 ? (
        <View
          style={sx('absolute items-center justify-center rounded-full', {
            backgroundColor: colors.red,
            borderColor: colors.appBg,
            borderWidth: 2,
            height: 18,
            minWidth: 18,
            paddingHorizontal: 4,
            right: -2,
            top: -2,
          })}
        >
          <Text style={sx('text-[10px] font-black text-white')}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------- Pill */

export function Pill({ label, tone = 'neutral' }: { readonly label: string; readonly tone?: Tone }) {
  const { colors } = useTheme();
  const t = toneColors(tone, colors);
  return (
    <View style={sx('rounded-pill px-2.5', { backgroundColor: t.bg, paddingVertical: 4 })}>
      <Text style={sx('text-[11px] font-black', { color: t.fg })}>{label}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- ListRow */

export function ListRow({
  icon,
  iconTone = 'neutral',
  title,
  subtitle,
  value,
  trailing,
  onPress,
  danger = false,
  showChevron = true,
}: {
  readonly icon?: MobileIconName;
  readonly iconTone?: Tone;
  readonly title: string;
  readonly subtitle?: string;
  readonly value?: string;
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly danger?: boolean;
  readonly showChevron?: boolean;
}) {
  const { colors } = useTheme();
  const titleColor = danger ? colors.red : colors.text;
  const content = (pressed: boolean) => (
    <View
      style={sx('flex-row items-center px-4', {
        backgroundColor: pressed ? colors.inputSoft : 'transparent',
        gap: 12,
        minHeight: 56,
      })}
    >
      {icon ? <IconBadge icon={icon} tone={danger ? 'danger' : iconTone} size={34} /> : null}
      <View style={sx('flex-1', { minWidth: 0 })}>
        <Text style={sx('text-[15px] font-semibold', { color: titleColor })} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={sx('text-[13px] font-medium text-dim')} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text style={sx('text-[14px] font-semibold text-muted', { flexShrink: 1, maxWidth: '60%', textAlign: 'right' })} numberOfLines={1}>{value}</Text> : null}
      {trailing ?? (onPress && showChevron ? <MobileIcon name="chevronRight" size={17} strokeWidth={2.4} color={colors.textDim} /> : null)}
    </View>
  );
  if (!onPress) return content(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

/* ----------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={sx('flex-row rounded-pill', {
        backgroundColor: colors.inputSoft,
        borderColor: colors.cardBorder,
        borderWidth: 1,
        gap: 3,
        padding: 3,
      })}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={sx('flex-1 items-center justify-center rounded-pill', {
              backgroundColor: selected ? colors.surface : 'transparent',
              borderColor: selected ? colors.cardBorder : 'transparent',
              borderWidth: 1,
              minHeight: 38,
            })}
          >
            <Text style={sx('text-[13px] font-bold', { color: selected ? colors.text : colors.textDim })}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  readonly icon: MobileIconName;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={sx('items-center justify-center px-6', { paddingVertical: 48 })}>
      <View
        style={sx('items-center justify-center rounded-3xl', {
          backgroundColor: colors.primarySoft,
          height: 64,
          width: 64,
        })}
      >
        <MobileIcon name={icon} size={30} strokeWidth={2.2} color={colors.primary} />
      </View>
      <Text style={sx('mt-4 text-[18px] font-black text-text text-center')}>{title}</Text>
      {body ? (
        <Text style={sx('mt-1.5 text-[14px] font-medium text-dim text-center', { lineHeight: 20, maxWidth: 320 })}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={sx('mt-5')}>{action}</View> : null}
    </View>
  );
}
