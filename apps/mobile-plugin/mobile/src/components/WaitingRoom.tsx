import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WaitingRoomUi } from '../waitingRoomUi';
import { MobileIcon } from './MobileIcon';

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
  const stepItems =
    Array.isArray(waitingRoomUi.steps) && waitingRoomUi.steps.length > 0
      ? waitingRoomUi.steps
      : fallbackSteps;
  const statusText =
    typeof waitingRoomUi.status === 'string' && waitingRoomUi.status.length > 0
      ? waitingRoomUi.status
      : 'Not paired yet';

  return (
    <View style={styles.container}>
      <View style={styles.contentStack}>
        <View style={styles.heroCard}>
          <View style={styles.hero}>
            <View style={styles.glow} />
            <Image
              source={moxxyMascot}
              accessibilityLabel="Moxxy assistant mascot waving"
              resizeMode="contain"
              style={styles.mascot}
            />
          </View>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>{waitingRoomUi.eyebrow}</Text>
            <Text style={styles.title}>{waitingRoomUi.title}</Text>
            <Text style={styles.body}>{waitingRoomUi.body}</Text>
          </View>
        </View>
        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>{statusText}</Text>
          <View style={styles.instructions}>
            {stepItems.map((step, index) => (
              <View
                key={`${index}-${step}`}
                style={[
                  styles.instructionItem,
                  index > 0 ? styles.instructionItemSpaced : null,
                ]}
              >
                <View style={styles.instructionBadge}>
                  <Text style={styles.instructionBadgeText}>{index + 1}</Text>
                </View>
                <Text style={styles.instructionText}>{step}</Text>
              </View>
            ))}
          </View>
          <Pressable
            accessible
            accessibilityLabel="Open gateway pairing and scan QR code"
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.primaryAction,
              pressed ? styles.primaryActionPressed : null,
            ]}
            onPress={onOpenPairing}
          >
            <MobileIcon name="camera" size={18} strokeWidth={2.4} color="#ffffff" />
            <Text style={styles.primaryActionText}>{waitingRoomUi.actionLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#667085',
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
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  glow: {
    backgroundColor: 'rgba(219, 39, 119, 0.12)',
    borderRadius: 999,
    bottom: 6,
    height: 88,
    left: 58,
    position: 'absolute',
    right: 58,
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
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderColor: 'rgba(219, 39, 119, 0.18)',
    borderRadius: 28,
    borderWidth: 1,
    minHeight: 292,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    shadowColor: '#db2777',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 26,
  },
  instructionBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(219, 39, 119, 0.1)',
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    marginRight: 14,
    marginTop: 0,
    width: 30,
  },
  instructionBadgeText: {
    color: '#db2777',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  instructionItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    width: '100%',
  },
  instructionItemSpaced: {
    marginTop: 14,
  },
  instructionText: {
    color: '#475569',
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 21,
  },
  instructions: {
    alignSelf: 'stretch',
  },
  mascot: {
    height: 150,
    width: '100%',
  },
  primaryAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#db2777',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 50,
    paddingHorizontal: 18,
  },
  primaryActionPressed: {
    opacity: 0.82,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  stepsCard: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderColor: '#e3e8f5',
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 24,
    minHeight: 198,
    paddingBottom: 34,
    paddingHorizontal: 22,
    paddingTop: 24,
    shadowColor: '#0f172a',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
  },
  stepsTitle: {
    color: '#db2777',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 14,
  },
  title: {
    color: '#111827',
    flexShrink: 1,
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
});
