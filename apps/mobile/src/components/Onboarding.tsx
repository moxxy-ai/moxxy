import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mobileInk, mobileSurface } from '../styles/tokens';
import { MobileIcon, type MobileIconName } from './MobileIcon';
import { Appear, PressableScale, useReduceMotion } from './primitives/motion';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;

interface Slide {
  readonly key: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly icon: MobileIconName;
  readonly mascot?: boolean;
}

const SLIDES: ReadonlyArray<Slide> = [
  {
    key: 'welcome',
    eyebrow: 'Welcome',
    title: 'Your agent,\nin your pocket',
    body: 'Moxxy Mobile is a live extension of your desktop — the same runtime, now in your hand.',
    icon: 'message',
    mascot: true,
  },
  {
    key: 'pair',
    eyebrow: 'Pair',
    title: 'Connect\nin seconds',
    body: 'Open Moxxy Desktop, head to Settings → Mobile, and scan the QR code. Encrypted, no account needed.',
    icon: 'camera',
  },
  {
    key: 'drive',
    eyebrow: 'Drive',
    title: 'Run every\nsession',
    body: 'Jump into any workspace, approve actions, switch models and modes, and watch tools stream live.',
    icon: 'bolt',
  },
  {
    key: 'anywhere',
    eyebrow: 'Anywhere',
    title: 'Take over\non the fly',
    body: 'Away from your desk? Your phone becomes mission control for everything Moxxy is doing.',
    icon: 'gateway',
  },
];

interface OnboardingProps {
  readonly onDone: () => void;
}

export function Onboarding({ onDone }: OnboardingProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      float.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduce]);

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    // Native-driven: every scroll-linked interpolation below targets transform /
    // opacity only (never a layout prop like width), so the parallax and dots run
    // on the UI thread. Animating `width` here would crash the native animated
    // module ("Style property 'width' is not supported").
    useNativeDriver: true,
    listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      setIndex((current) => (current === next ? current : next));
    },
  });

  const isLast = index >= SLIDES.length - 1;

  const goNext = () => {
    if (isLast) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const skipOpacity = scrollX.interpolate({
    inputRange: [(SLIDES.length - 2) * width, (SLIDES.length - 1) * width],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.skip, { top: insets.top + 8, opacity: skipOpacity }]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
          hitSlop={10}
          scaleTo={0.92}
          style={styles.skipButton}
          onPress={onDone}
        >
          <Text style={styles.skipText}>Skip</Text>
        </PressableScale>
      </Animated.View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{ alignItems: 'center' }}
      >
        {SLIDES.map((slide, slideIndex) => (
          <SlideView
            key={slide.key}
            slide={slide}
            index={slideIndex}
            width={width}
            scrollX={scrollX}
            floatY={floatY}
            topInset={insets.top}
          />
        ))}
      </Animated.ScrollView>

      <Appear from="up" style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.dots}>
          {SLIDES.map((slide, dotIndex) => {
            const inputRange = [(dotIndex - 1) * width, dotIndex * width, (dotIndex + 1) * width];
            // Widen the active dot into a pill via scaleX (native-safe) instead of
            // animating `width` (a layout prop the native driver rejects).
            const dotScaleX = scrollX.interpolate({ inputRange, outputRange: [1, 3.25, 1], extrapolate: 'clamp' });
            const dotOpacity = scrollX.interpolate({ inputRange, outputRange: [0.32, 1, 0.32], extrapolate: 'clamp' });
            return (
              <Animated.View
                key={`dot-${slide.key}`}
                style={[styles.dot, { opacity: dotOpacity, transform: [{ scaleX: dotScaleX }] }]}
              />
            );
          })}
        </View>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get started' : 'Next slide'}
          scaleTo={0.96}
          style={styles.cta}
          onPress={goNext}
        >
          <Text style={styles.ctaText}>{isLast ? 'Get started' : 'Next'}</Text>
          <MobileIcon name={isLast ? 'check' : 'chevronRight'} size={18} strokeWidth={2.6} color="#ffffff" />
        </PressableScale>
      </Appear>
    </View>
  );
}

function SlideView({
  slide,
  index,
  width,
  scrollX,
  floatY,
  topInset,
}: {
  readonly slide: Slide;
  readonly index: number;
  readonly width: number;
  readonly scrollX: Animated.Value;
  readonly floatY: Animated.AnimatedInterpolation<number>;
  readonly topInset: number;
}) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  const artTranslate = scrollX.interpolate({ inputRange, outputRange: [width * 0.22, 0, -width * 0.22], extrapolate: 'clamp' });
  const artScale = scrollX.interpolate({ inputRange, outputRange: [0.82, 1, 0.82], extrapolate: 'clamp' });
  const artOpacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const copyTranslate = scrollX.interpolate({ inputRange, outputRange: [40, 0, -40], extrapolate: 'clamp' });
  const copyOpacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });

  return (
    <View style={{ width, alignItems: 'center', paddingHorizontal: 28, paddingTop: topInset + 64 }}>
      <Animated.View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          height: 260,
          marginBottom: 14,
          opacity: artOpacity,
          transform: [{ translateX: artTranslate }, { scale: artScale }, { translateY: floatY }],
        }}
      >
        <View style={styles.artGlass}>
          {slide.mascot ? (
            <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy mascot" style={styles.mascot} />
          ) : (
            <View style={styles.artTile}>
              <MobileIcon name={slide.icon} size={54} strokeWidth={2.4} color="#ffffff" />
            </View>
          )}
        </View>
      </Animated.View>

      <Animated.View style={{ alignItems: 'center', opacity: copyOpacity, transform: [{ translateX: copyTranslate }] }}>
        <Text style={styles.eyebrow}>{slide.eyebrow.toUpperCase()}</Text>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  artGlass: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 48,
    borderWidth: 1,
    height: 200,
    justifyContent: 'center',
    width: 200,
  },
  artTile: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 32,
    height: 120,
    justifyContent: 'center',
    width: 120,
  },
  body: {
    color: mobileInk.muted,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 23,
    maxWidth: 320,
    textAlign: 'center',
  },
  cta: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    height: 56,
    justifyContent: 'center',
    width: '100%',
  },
  ctaText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  dot: {
    backgroundColor: mobileSurface.accent,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  dots: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 22,
  },
  eyebrow: {
    color: '#db2777',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 10,
  },
  footer: {
    paddingHorizontal: 28,
    paddingTop: 6,
  },
  mascot: {
    height: 150,
    width: 150,
  },
  root: {
    backgroundColor: mobileSurface.appBg,
    flex: 1,
    justifyContent: 'space-between',
  },
  skip: {
    position: 'absolute',
    right: 18,
    zIndex: 10,
  },
  skipButton: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipText: {
    color: mobileInk.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: mobileInk.strong,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 37,
    marginBottom: 14,
    textAlign: 'center',
  },
});
