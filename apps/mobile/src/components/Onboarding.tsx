import { useRef, useState } from 'react';
import {
  FlatList,
  Image,
  type ImageSourcePropType,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useQrScanner } from '@/hooks/useQrScanner';
import { useStorageState } from '../hooks/storage';
import { buildPairingUiState } from '@/pairingUi';
import { submitManualPairingLink } from '@/pairingFlow';
import { Button, Card } from '@/ui/kit';
import { MobileIcon, type MobileIconName } from './MobileIcon';
import { QrScannerSheet } from './QrScannerSheet';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;
const SEEN_KEY = 'moxxy.onboarding.seen';

interface Slide {
  readonly icon: MobileIconName;
  readonly title: string;
  readonly body: string;
}

const SLIDES: ReadonlyArray<Slide> = [
  { icon: 'message', title: 'Your agent, in your pocket', body: 'Drive the same moxxy agent on your Mac from your phone — chats, tools, and live activity stay in sync.' },
  { icon: 'grid', title: 'Automate everything', body: 'Kick off multi-step workflows and recurring schedules, then watch them run from anywhere.' },
  { icon: 'gateway', title: 'Private and secure', body: 'Pairing runs over an end-to-end encrypted link, so your messages stay between your phone and your Mac.' },
];

export function Onboarding() {
  const [[loading, seen], setSeen] = useStorageState(SEEN_KEY);
  if (loading) return <Backdrop />;
  if (seen !== '1') return <OnboardingCarousel onDone={() => setSeen('1')} />;
  return <PairingScreen />;
}

function Backdrop() {
  const { colors } = useTheme();
  return <View style={sx('absolute', { backgroundColor: colors.appBg, bottom: 0, left: 0, right: 0, top: 0 })} />;
}

function OnboardingCarousel({ onDone }: { readonly onDone: () => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const last = index >= SLIDES.length - 1;

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };
  const next = () => {
    if (last) onDone();
    else listRef.current?.scrollToOffset({ offset: (index + 1) * width, animated: true });
  };

  return (
    <View style={sx('absolute', { backgroundColor: colors.appBg, bottom: 0, left: 0, right: 0, top: 0 })}>
      <SafeAreaView style={sx('flex-1')} edges={['top', 'bottom']}>
        <View style={sx('flex-row justify-end px-4 pt-2')}>
          <Pressable accessibilityRole="button" accessibilityLabel="Skip" hitSlop={8} onPress={onDone}>
            <Text style={sx('text-[15px] font-semibold text-dim')}>Skip</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={SLIDES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          keyExtractor={(item) => item.title}
          renderItem={({ item }) => (
            <View style={[sx('flex-1 items-center justify-center px-8'), { width }]}>
              <View style={sx('items-center justify-center', { height: 128, width: 128 })}>
                <View style={sx('absolute rounded-full', { backgroundColor: colors.primary, height: 128, opacity: 0.12, width: 128 })} />
                <View style={sx('items-center justify-center rounded-3xl', { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderWidth: 1, height: 84, width: 84 })}>
                  <MobileIcon name={item.icon} size={38} strokeWidth={2.2} color={colors.primary} />
                </View>
              </View>
              <Text style={sx('mt-7 text-[26px] font-black text-text text-center', { letterSpacing: -0.5 })}>{item.title}</Text>
              <Text style={sx('mt-3 text-[15px] font-medium text-muted text-center', { lineHeight: 22, maxWidth: 320 })}>{item.body}</Text>
            </View>
          )}
        />

        <View style={sx('items-center px-6 pb-2', { gap: 20 })}>
          <View style={sx('flex-row', { gap: 8 })}>
            {SLIDES.map((slide, i) => (
              <View
                key={slide.title}
                style={sx('rounded-full', {
                  backgroundColor: i === index ? colors.primary : colors.cardBorderStrong,
                  height: 7,
                  width: i === index ? 22 : 7,
                })}
              />
            ))}
          </View>
          <View style={sx('self-stretch')}>
            <Button label={last ? 'Get started' : 'Next'} onPress={next} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const STEPS = [
  'Open Moxxy Desktop on your Mac.',
  'Enable the gateway on Moxxy Desktop.',
  'Scan the QR code it shows.',
] as const;

function PairingScreen() {
  const { colors } = useTheme();
  // Use the SHARED pairing instance from the gateway store — the home-screen gate
  // watches the same `pairing.transportReady`, so a successful scan advances past
  // onboarding. (A local usePairing() would connect a throwaway instance.)
  const { pairing } = useGatewayStore();
  const qrScanner = useQrScanner(pairing.pairFromQrPayload);
  const [manualOpen, setManualOpen] = useState(false);
  const [link, setLink] = useState('');
  const pairingUi = buildPairingUiState({
    token: pairing.token,
    transportReady: pairing.transportReady,
    scanning: qrScanner.processing,
    permission: qrScanner.permission,
  });

  const submitManual = () => {
    void submitManualPairingLink({
      dismissKeyboard: Keyboard.dismiss,
      pairFromQrPayload: pairing.pairFromQrPayload,
      rawLink: link,
    });
  };

  return (
    <View style={sx('absolute', { backgroundColor: colors.appBg, bottom: 0, left: 0, right: 0, top: 0 })}>
      <SafeAreaView style={sx('flex-1')} edges={['top', 'bottom']}>
        <View style={sx('flex-1 justify-center px-5')}>
          <View style={sx('items-center')}>
            <View style={sx('items-center justify-center', { height: 140, width: 140 })}>
              <View style={sx('absolute rounded-full', { backgroundColor: colors.primary, height: 140, opacity: 0.1, width: 140 })} />
              <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy assistant mascot waving" style={{ height: 128, width: 128 }} />
            </View>
            <Text style={sx('mt-4 text-[13px] font-black uppercase tracking-wide text-primary')}>Moxxy Mobile</Text>
            <Text style={sx('mt-1 text-[26px] font-black text-text text-center', { letterSpacing: -0.5 })}>Connect to your Mac</Text>
            <Text style={sx('mt-2 text-[15px] font-medium text-muted text-center', { lineHeight: 21, maxWidth: 320 })}>
              Pair this phone with Moxxy Desktop to drive the same agent, sessions, and tools from anywhere.
            </Text>
          </View>

          <Card style={sx('mt-7')}>
            {STEPS.map((step, index) => (
              <View key={step} style={sx('flex-row items-center', { gap: 12, marginTop: index === 0 ? 0 : 14 })}>
                <View style={sx('items-center justify-center rounded-full', { backgroundColor: colors.primarySoft, height: 28, width: 28 })}>
                  <Text style={sx('text-[13px] font-black text-primary')}>{index + 1}</Text>
                </View>
                <Text style={sx('flex-1 text-[14px] font-semibold text-text', { lineHeight: 19 })}>{step}</Text>
              </View>
            ))}
          </Card>

          {pairing.error ? (
            <View style={sx('mt-4 rounded-2xl px-4 py-3', { backgroundColor: colors.redSoft, borderColor: colors.redBorder, borderWidth: 1 })}>
              <Text style={sx('text-[13px] font-semibold', { color: colors.redText })}>{pairing.error}</Text>
            </View>
          ) : null}

          {manualOpen ? (
            <Card style={sx('mt-4')}>
              <Text style={sx('text-[13px] font-bold text-text')}>Pairing link</Text>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder="ws://192.168.0.10:8765?t=…"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                style={sx('mt-2 rounded-xl px-3 text-[15px] text-text', { backgroundColor: colors.inputSoft, borderColor: colors.cardBorder, borderWidth: 1, minHeight: 46 })}
              />
              <View style={sx('mt-3')}>
                <Button label={pairing.loading ? 'Connecting…' : 'Connect'} icon="gateway" onPress={submitManual} disabled={pairing.loading} />
              </View>
            </Card>
          ) : null}

          <View style={sx('mt-6', { gap: 10 })}>
            <Button label={pairingUi.scanButtonLabel} icon="camera" onPress={() => void qrScanner.openScanner()} disabled={!pairingUi.scanButtonEnabled} />
            <Button label={manualOpen ? 'Hide manual pairing' : 'Enter link manually'} variant="ghost" onPress={() => setManualOpen((open) => !open)} />
          </View>
        </View>
      </SafeAreaView>

      <QrScannerSheet
        open={qrScanner.open}
        processing={qrScanner.processing}
        permission={qrScanner.permission}
        ui={pairingUi}
        onRequestPermission={() => void qrScanner.requestPermission()}
        onScanned={(raw) => void qrScanner.handlePayload(raw)}
        onCancel={qrScanner.closeScanner}
      />
    </View>
  );
}
