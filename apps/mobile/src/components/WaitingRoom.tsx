import { useEffect, useRef } from 'react';
import { Animated, Image, type ImageSourcePropType, StyleSheet, Text, View } from 'react-native';
import type { WaitingRoomUi } from '../waitingRoomUi';
import { mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear, PressableScale, useReduceMotion } from './primitives/motion';

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
        Animated.timing(float, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduce]);

  const stepItems =
    Array.isArray(waitingRoomUi.steps) && waitingRoomUi.steps.length > 0 ? waitingRoomUi.steps : fallbackSteps;
  const statusText =
    typeof waitingRoomUi.status === 'string' && waitingRoomUi.status.length > 0 ? waitingRoomUi.status : 'Not paired yet';
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <View style={styles.container}>
      <View style={styles.contentStack}>
        <Appear from="up" distance={14}>
          <View style={styles.heroCard}>
            <View style={styles.heroGlow}>
              <Gradient preset="brand" radius={999} style={StyleSheet.absoluteFill} />
            </View>
            <View style={styles.hero}>
              <Animated.View style={{ transform: [{ translateY: floatY }] }}>
                <Image source={moxxyMascot} accessibilityLabel="Moxxy assistant mascot waving" resizeMode="contain" style={styles.mascot} />
              </Animated.View>
            </View>
            <View style={styles.copy}>
              <Text style={styles.eyebrow}>{waitingRoomUi.eyebrow}</Text>
              <Text style={styles.title}>{waitingRoomUi.title}</Text>
              <Text style={styles.body}>{waitingRoomUi.body}</Text>
            </View>
          </View>
        </Appear>

        <Appear from="up" distance={18} delay={90}>
          <View style={styles.stepsCard}>
            <View style={styles.stepsHeader}>
              <View style={styles.statusDot} />
              <Text style={styles.stepsTitle}>{statusText}</Text>
            </View>
            <View style={styles.instructions}>
              {stepItems.map((step, index) => (
                <View key={`${index}-${step}`} style={[styles.instructionItem, index > 0 ? styles.instructionItemSpaced : null]}>
                  <Gradient preset="brand" radius={999} style={styles.instructionBadge}>
                    <Text style={styles.instructionBadgeText}>{index + 1}</Text>
                  </Gradient>
                  <Text style={styles.instructionText}>{step}</Text>
                </View>
              ))}
            </View>
            <PressableScale
              accessible
              accessibilityLabel="Open gateway pairing and scan QR code"
              accessibilityRole="button"
              hitSlop={8}
              scaleTo={0.97}
              style={styles.primaryAction}
              onPress={onOpenPairing}
            >
              <Gradient preset="cta" radius={18} style={StyleSheet.absoluteFill} />
              <MobileIcon name="camera" size={18} strokeWidth={2.4} color="#ffffff" />
              <Text style={styles.primaryActionText}>{waitingRoomUi.actionLabel}</Text>
            </PressableScale>
          </View>
        </Appear>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: mobileInk.muted,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingBottom: 22,
    paddingHorizontal: 18,
    paddingTop: 92,
  },
  contentStack: {
    alignSelf: 'center',
    maxWidth: 430,
    width: '100%',
  },
  copy: {
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 10,
  },
  eyebrow: {
    color: '#db2777',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  hero: {
    alignItems: 'center',
    alignSelf: 'center',
    height: 154,
    justifyContent: 'flex-end',
    maxWidth: 220,
    width: '64%',
  },
  heroCard: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderColor: 'rgba(249, 168, 212, 0.45)',
    borderRadius: 30,
    borderTopColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    minHeight: 292,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    shadowColor: '#db2777',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 34,
  },
  heroGlow: {
    bottom: 30,
    height: 120,
    left: 50,
    opacity: 0.22,
    position: 'absolute',
    right: 50,
  },
  instructionBadge: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    marginRight: 14,
    width: 30,
  },
  instructionBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  instructionItem: {
    alignItems: 'center',
    flexDirection: 'row',
    width: '100%',
  },
  instructionItemSpaced: {
    marginTop: 14,
  },
  instructionText: {
    color: mobileInk.muted,
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  instructions: {
    alignSelf: 'stretch',
  },
  mascot: {
    height: 150,
    width: 180,
  },
  primaryAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 52,
    overflow: 'hidden',
    paddingHorizontal: 18,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  statusDot: {
    backgroundColor: '#f59e0b',
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  stepsCard: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 24,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    marginTop: 22,
    minHeight: 198,
    paddingBottom: 28,
    paddingHorizontal: 22,
    paddingTop: 22,
    shadowColor: '#1e2540',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 26,
  },
  stepsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  stepsTitle: {
    color: '#db2777',
    fontSize: 14,
    fontWeight: '900',
  },
  title: {
    color: mobileInk.strong,
    flexShrink: 1,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 29,
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
});
