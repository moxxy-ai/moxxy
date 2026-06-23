import { useEffect, useRef } from 'react';
import { Animated, Image, type ImageSourcePropType, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WaitingRoomUi } from '../waitingRoomUi';
import { mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear, PressableScale, PulseDot, useReduceMotion } from './primitives/motion';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;
const fallbackSteps = [
  'Open Moxxy Desktop on your Mac.',
  'Go to Settings -> Mobile.',
  'Turn on Enable mobile gateway and scan the QR code.',
] as const;

interface WaitingRoomProps {
  readonly waitingRoomUi: WaitingRoomUi;
  readonly onOpenPairing: () => void;
}

export function WaitingRoom({ waitingRoomUi, onOpenPairing }: WaitingRoomProps) {
  const reduce = useReduceMotion();
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      float.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduce]);

  const stepItems =
    Array.isArray(waitingRoomUi.steps) && waitingRoomUi.steps.length > 0 ? waitingRoomUi.steps : fallbackSteps;
  const statusText =
    typeof waitingRoomUi.status === 'string' && waitingRoomUi.status.length > 0 ? waitingRoomUi.status : 'Not paired yet';
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.contentStack}>
        <Appear from="scale">
          <View style={styles.statusPill}>
            <PulseDot color="#f59e0b" size={8} pulsing />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        </Appear>

        <Appear from="up" delay={60} distance={16}>
          <View style={styles.hero}>
            <Gradient
              direction="vertical"
              stops={[
                { offset: 0, color: '#fde9f4' },
                { offset: 1, color: '#ffffff' },
              ]}
              style={styles.heroDisc}
            />
            <Animated.View style={[styles.mascotWrap, { transform: [{ translateY: floatY }] }]}>
              <Image source={moxxyMascot} accessibilityLabel="Moxxy assistant mascot waving" resizeMode="contain" style={styles.mascot} />
            </Animated.View>
          </View>

          <Text style={styles.eyebrow}>{waitingRoomUi.eyebrow}</Text>
          <Text style={styles.title}>{waitingRoomUi.title}</Text>
          <Text style={styles.body}>{waitingRoomUi.body}</Text>
        </Appear>

        <Appear from="up" delay={120} distance={18}>
          <PressableScale
            accessible
            accessibilityLabel="Open gateway pairing and scan QR code"
            accessibilityRole="button"
            hitSlop={8}
            scaleTo={0.97}
            style={styles.primaryAction}
            onPress={onOpenPairing}
          >
            <Gradient preset="cta" radius={20} style={StyleSheet.absoluteFill} />
            <MobileIcon name="camera" size={20} strokeWidth={2.4} color="#ffffff" />
            <Text style={styles.primaryActionText}>{waitingRoomUi.actionLabel}</Text>
            <MobileIcon name="chevronRight" size={18} strokeWidth={2.6} color="#ffffff" />
          </PressableScale>
        </Appear>

        <Appear from="up" delay={180} distance={20}>
          <View style={styles.stepsPanel}>
            <Text style={styles.stepsHeading}>How to pair</Text>
            <View style={styles.steps}>
              {stepItems.map((step, index) => {
                const isLast = index === stepItems.length - 1;
                return (
                  <View key={`${index}-${step}`} style={[styles.stepEntry, isLast ? styles.stepEntryLast : null]}>
                    {isLast ? null : <View style={styles.stepConnector} />}
                    <Gradient preset="cta" radius={999} style={styles.stepNode}>
                      <Text style={styles.stepNumber}>{index + 1}</Text>
                    </Gradient>
                    <Text style={styles.stepText}>{step}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </Appear>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    color: mobileInk.soft,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 330,
    textAlign: 'center',
  },
  container: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 36,
    paddingHorizontal: 22,
    paddingTop: 40,
  },
  contentStack: {
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 440,
    width: '100%',
  },
  eyebrow: {
    color: '#db2777',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 22,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  hero: {
    alignItems: 'center',
    height: 196,
    justifyContent: 'center',
    width: '100%',
  },
  heroDisc: {
    borderColor: 'rgba(249, 168, 212, 0.5)',
    borderRadius: 999,
    borderWidth: 1,
    height: 188,
    position: 'absolute',
    width: 188,
  },
  mascot: {
    height: 178,
    width: 178,
  },
  mascotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    marginTop: 28,
    minHeight: 58,
    overflow: 'hidden',
    paddingHorizontal: 20,
    shadowColor: '#db2777',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  scroll: {
    flex: 1,
  },
  statusPill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 999,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#1e2540',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  statusText: {
    color: mobileInk.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  stepConnector: {
    backgroundColor: 'rgba(249, 168, 212, 0.55)',
    bottom: -22,
    left: 13,
    position: 'absolute',
    top: 28,
    width: 2,
  },
  stepEntry: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 22,
    position: 'relative',
  },
  stepEntryLast: {
    marginBottom: 0,
  },
  stepNode: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepNumber: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  stepText: {
    color: mobileInk.muted,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    paddingTop: 3,
  },
  steps: {
    alignSelf: 'stretch',
  },
  stepsHeading: {
    color: mobileInk.strong,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 18,
  },
  stepsPanel: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 24,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    marginTop: 26,
    padding: 22,
    shadowColor: '#1e2540',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 26,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 32,
    marginTop: 8,
    textAlign: 'center',
  },
});
