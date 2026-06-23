import { useState } from 'react';
import { Image, type ImageSourcePropType, Keyboard, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useQrScanner } from '@/hooks/useQrScanner';
import { buildPairingUiState } from '@/pairingUi';
import { Button, Card } from '@/ui/kit';
import { QrScannerSheet } from './QrScannerSheet';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;

const STEPS = [
  'Open Moxxy Desktop on your Mac.',
  'Open the Mobile tab in the sidebar and enable the gateway.',
  'Scan the QR code it shows.',
] as const;

export function Onboarding() {
  const { colors } = useTheme();
  // Use the SHARED pairing instance from the gateway store — the home-screen
  // gate watches the same `pairing.transportReady`, so a successful scan
  // actually advances past onboarding. (A local usePairing() would connect a
  // throwaway instance the gate never sees.)
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
    const value = link.trim();
    if (!value) return;
    Keyboard.dismiss();
    pairing.setGatewayUrl(value);
    void pairing.loadPairing();
  };

  return (
    <View style={sx('absolute', { backgroundColor: colors.appBg, bottom: 0, left: 0, right: 0, top: 0 })}>
      <SafeAreaView style={sx('flex-1')} edges={['top', 'bottom']}>
        <View style={sx('flex-1 justify-center px-5')}>
          <View style={sx('items-center')}>
            <View
              style={sx('items-center justify-center rounded-3xl', {
                backgroundColor: colors.cardBg,
                borderColor: colors.cardBorder,
                borderWidth: 1,
                height: 132,
                overflow: 'hidden',
                width: 132,
              })}
            >
              <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy assistant mascot waving" style={{ height: 118, width: 118 }} />
            </View>
            <Text style={sx('mt-5 text-[13px] font-black uppercase tracking-wide text-primary')}>Moxxy Mobile</Text>
            <Text style={sx('mt-1 text-[26px] font-black text-text text-center', { letterSpacing: -0.5 })}>
              Connect to your Mac
            </Text>
            <Text style={sx('mt-2 text-[15px] font-medium text-muted text-center', { lineHeight: 21, maxWidth: 320 })}>
              Pair this phone with Moxxy Desktop to drive the same agent, sessions, and tools from anywhere.
            </Text>
          </View>

          <Card style={sx('mt-7')}>
            {STEPS.map((step, index) => (
              <View key={step} style={sx('flex-row items-center', { gap: 12, marginTop: index === 0 ? 0 : 14 })}>
                <View
                  style={sx('items-center justify-center rounded-full', {
                    backgroundColor: colors.primarySoft,
                    height: 28,
                    width: 28,
                  })}
                >
                  <Text style={sx('text-[13px] font-black text-primary')}>{index + 1}</Text>
                </View>
                <Text style={sx('flex-1 text-[14px] font-semibold text-text', { lineHeight: 19 })}>{step}</Text>
              </View>
            ))}
          </Card>

          {pairing.error ? (
            <View
              style={sx('mt-4 rounded-2xl px-4 py-3', {
                backgroundColor: colors.redSoft,
                borderColor: colors.redBorder,
                borderWidth: 1,
              })}
            >
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
                style={sx('mt-2 rounded-xl px-3 text-[15px] text-text', {
                  backgroundColor: colors.inputSoft,
                  borderColor: colors.cardBorder,
                  borderWidth: 1,
                  minHeight: 46,
                })}
              />
              <View style={sx('mt-3')}>
                <Button label={pairing.loading ? 'Connecting…' : 'Connect'} icon="gateway" onPress={submitManual} disabled={pairing.loading} />
              </View>
            </Card>
          ) : null}

          <View style={sx('mt-6', { gap: 10 })}>
            <Button
              label={pairingUi.scanButtonLabel}
              icon="camera"
              onPress={() => void qrScanner.openScanner()}
              disabled={!pairingUi.scanButtonEnabled}
            />
            <Button
              label={manualOpen ? 'Hide manual pairing' : 'Enter link manually'}
              variant="ghost"
              onPress={() => setManualOpen((open) => !open)}
            />
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
