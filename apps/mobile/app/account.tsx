import { Button, Card, DetailHeader, Divider, IconBadge, ListRow, Pill, SectionLabel, Segmented } from '@/ui/kit';
import { useTheme } from '@/theme/ThemeProvider';
import { sx } from '@/styles/tokens';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useQrScanner } from '@/hooks/useQrScanner';
import { buildPairingUiState } from '@/pairingUi';
import { QrScannerSheet } from '@/components/QrScannerSheet';
import { useRouter } from 'expo-router';
import { ScrollView, Switch, Text, View } from 'react-native';

export default function AccountScreen() {
  const { colors, mode, setMode } = useTheme();
  const router = useRouter();
  const { session, pairing, autoApprove, socketStatus, gatewayConnected } = useGatewayStore();
  const qrScanner = useQrScanner(pairing.pairFromQrPayload);
  const paired = pairing.transportReady;
  const subtitle = gatewayConnected ? 'Connected to your gateway' : paired ? 'Reconnecting…' : 'Not paired yet';

  return (
    <View style={sx('flex-1', { backgroundColor: colors.appBg })}>
      <DetailHeader title="Account" subtitle={subtitle} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ gap: 8, padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <SectionLabel>Appearance</SectionLabel>
        <Card>
          <Text style={sx('text-[15px] font-bold text-text', { marginBottom: 12 })}>Theme</Text>
          <Segmented
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </Card>

        <SectionLabel style={{ marginTop: 20 }}>Connection</SectionLabel>
        <Card>
          <View style={sx('flex-row items-center justify-between', { gap: 12, marginBottom: 14 })}>
            <Text style={sx('text-[15px] font-bold text-text')}>Gateway</Text>
            <Pill label={gatewayConnected ? 'Connected' : 'Not paired'} tone={gatewayConnected ? 'success' : 'warn'} />
          </View>
          <ListRow icon="gateway" iconTone={gatewayConnected ? 'success' : 'neutral'} title="Gateway URL" subtitle={pairing.gatewayUrl || '—'} showChevron={false} />
          {pairing.error ? (
            <View style={sx('rounded-2xl', { backgroundColor: colors.redSoft, borderColor: colors.redBorder, borderWidth: 1, marginTop: 12, padding: 12 })}>
              <Text style={sx('text-[13px] font-medium', { color: colors.redText, lineHeight: 18 })}>{pairing.error}</Text>
            </View>
          ) : null}
          <View style={sx({ gap: 10, marginTop: 16 })}>
            <Button label={paired ? 'Re-pair' : 'Scan QR code'} variant={paired ? 'secondary' : 'primary'} icon="camera" onPress={() => void qrScanner.openScanner()} />
            {paired ? <Button label="Disconnect" variant="danger" icon="power" onPress={() => pairing.disconnect()} /> : null}
          </View>
        </Card>

        <SectionLabel style={{ marginTop: 20 }}>Automation</SectionLabel>
        <Card>
          <View style={sx('flex-row items-center', { gap: 12 })}>
            <IconBadge icon="bolt" tone="brand" size={34} />
            <View style={sx('flex-1', { minWidth: 0 })}>
              <Text style={sx('text-[15px] font-semibold text-text')}>Bypass mode</Text>
              <Text style={sx('text-[13px] font-medium text-dim')}>Auto-approve tool calls</Text>
            </View>
            <Switch
              value={autoApprove.enabled}
              onValueChange={autoApprove.setAutoApprove}
              trackColor={{ false: colors.cardBorderStrong, true: colors.primary }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.inputSoft}
            />
          </View>
        </Card>

        <SectionLabel style={{ marginTop: 20 }}>Runtime</SectionLabel>
        <Card padded={false}>
          <ListRow title="Socket" value={socketStatus} showChevron={false} />
          <Divider inset={16} />
          <ListRow title="Provider" value={session.activeProvider ?? 'Unknown'} showChevron={false} />
          <Divider inset={16} />
          <ListRow title="Mode" value={session.activeMode ?? 'Unknown'} showChevron={false} />
        </Card>

        <SectionLabel style={{ marginTop: 20 }}>About</SectionLabel>
        <Card>
          <View style={sx('items-center', { paddingVertical: 8 })}>
            <Text style={sx('text-[16px] font-black text-text')}>Moxxy Mobile</Text>
            <Text style={sx('mt-1 text-[13px] font-medium text-dim text-center', { lineHeight: 18 })}>Your workspace, in your pocket.</Text>
          </View>
        </Card>

        <View style={{ marginTop: 24 }}>
          <Button label="Redo onboarding" variant="secondary" icon="refresh" onPress={() => pairing.disconnect()} />
        </View>
      </ScrollView>

      <QrScannerSheet
        open={qrScanner.open}
        processing={qrScanner.processing}
        permission={qrScanner.permission}
        ui={buildPairingUiState({ token: pairing.token, transportReady: pairing.transportReady, scanning: qrScanner.processing, permission: qrScanner.permission })}
        onRequestPermission={() => void qrScanner.requestPermission()}
        onScanned={(raw) => void qrScanner.handlePayload(raw)}
        onCancel={qrScanner.closeScanner}
      />
    </View>
  );
}
