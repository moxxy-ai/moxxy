import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import type { CameraPermissionState } from '../pairingUi';
import { buildPairingUiState } from '../pairingUi';
import { MobileIcon } from './MobileIcon';

interface ConnectionSettingsProps {
  readonly gatewayUrl: string;
  readonly token: string | null;
  readonly code: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly autoApprove: boolean;
  readonly socketStatus: string;
  readonly qrScanning: boolean;
  readonly qrPermission: CameraPermissionState;
  readonly manualPairingOpen: boolean;
  readonly activeMode?: string | null;
  readonly activeProvider?: string | null;
  readonly onGatewayUrlChange: (value: string) => void;
  readonly onScanQr: () => void;
  readonly onToggleManualPairing: () => void;
  readonly onRefreshPairing: () => void;
  readonly onPair: () => void;
  readonly onDisconnect: () => void;
  readonly onAutoApproveChange: (value: boolean) => void;
}

export function ConnectionSettings(props: ConnectionSettingsProps) {
  // Draft URL stays local while typing — committing per keystroke would churn
  // the WS client (the socket effect re-dials on every gatewayUrl change).
  const [draftUrl, setDraftUrl] = useState(props.gatewayUrl);
  useEffect(() => {
    setDraftUrl(props.gatewayUrl);
  }, [props.gatewayUrl]);
  const commitDraftUrl = () => {
    if (draftUrl !== props.gatewayUrl) props.onGatewayUrlChange(draftUrl);
  };
  const canPair = props.code.length > 0 && !props.loading;
  const pairingUi = buildPairingUiState({
    token: props.token,
    scanning: props.qrScanning,
    permission: props.qrPermission,
  });
  return (
    <View className="gap-4">
      <View className="gap-3 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card">
        <View className="flex-row items-center justify-between">
          <Text className="text-[16px] font-bold text-text">Gateway</Text>
          <View className={`rounded-pill px-2.5 py-1 ${props.token ? 'bg-green/10' : 'bg-amber/10'}`}>
            <Text className={`text-[11px] font-black ${props.token ? 'text-green' : 'text-amber'}`}>
              {pairingUi.statusLabel}
            </Text>
          </View>
        </View>
        <Pressable
          className={`min-h-14 flex-row items-center justify-center gap-2 rounded-block ${pairingUi.scanButtonEnabled ? 'bg-primary' : 'bg-cardBorder'}`}
          disabled={!pairingUi.scanButtonEnabled}
          onPress={props.onScanQr}
        >
          <MobileIcon name="camera" color={pairingUi.scanButtonEnabled ? '#ffffff' : '#94a3b8'} size={21} />
          <Text className={`text-[14px] font-black ${pairingUi.scanButtonEnabled ? 'text-white' : 'text-dim'}`}>
            {pairingUi.scanButtonLabel}
          </Text>
        </Pressable>
        <Pressable
          className="min-h-11 flex-row items-center justify-between rounded-block border border-cardBorder bg-cardBg px-3"
          onPress={props.onToggleManualPairing}
        >
          <Text className="text-[13px] font-bold text-muted">{pairingUi.manualPairingToggleLabel}</Text>
          <Text className="text-[18px] font-black text-primaryStrong">{props.manualPairingOpen ? '-' : '+'}</Text>
        </Pressable>
        {props.manualPairingOpen || pairingUi.manualPairingVisible ? (
          <View className="gap-3">
            <TextInput
              value={draftUrl}
              onChangeText={setDraftUrl}
              onBlur={commitDraftUrl}
              onSubmitEditing={commitDraftUrl}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              className="min-h-11 rounded-block border border-cardBorder bg-cardBg px-3 text-[14px] text-text"
            />
            <View className="items-center rounded-card bg-primarySoft px-4 py-4">
              <Text className="text-[11px] font-black uppercase text-primaryStrong">Pairing code</Text>
              <Text className="mt-1 text-[34px] font-black text-primaryStrong">{props.code || '------'}</Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable className="min-h-11 flex-1 items-center justify-center rounded-block border border-cardBorder bg-cardBg" onPress={props.onRefreshPairing}>
                <Text className="text-[13px] font-bold text-muted">Refresh pairing</Text>
              </Pressable>
              <Pressable
                className={`min-h-11 flex-1 items-center justify-center rounded-block ${canPair ? 'bg-primary' : 'bg-cardBorder'}`}
                onPress={props.onPair}
                disabled={!canPair}
              >
                <Text className="text-[13px] font-bold text-white">Pair</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {props.error ? (
          <View className="rounded-block bg-red/10 px-3 py-2">
            <Text className="text-[13px] font-semibold text-red">{props.error}</Text>
          </View>
        ) : null}
        {props.token ? (
          <Pressable className="min-h-11 items-center justify-center rounded-block bg-red" onPress={props.onDisconnect}>
            <Text className="text-[13px] font-bold text-white">Disconnect</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="gap-3 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card">
        <Text className="text-[16px] font-bold text-text">Runtime</Text>
        <SettingRow label="Socket" value={props.socketStatus} />
        <SettingRow label="Provider" value={props.activeProvider ?? 'Unknown'} />
        <SettingRow label="Mode" value={props.activeMode ?? 'Unknown'} />
        <View className="flex-row items-center justify-between">
          <View className="mr-4 flex-1">
            <Text className="text-[14px] font-bold text-text">Bypass mode</Text>
            <Text className="text-[12px] leading-5 text-muted">Auto-approve tool calls for this workspace.</Text>
          </View>
          <Switch value={props.autoApprove} onValueChange={props.onAutoApproveChange} />
        </View>
      </View>
    </View>
  );
}

function SettingRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-cardBorder py-2">
      <Text className="text-[13px] font-semibold text-muted">{label}</Text>
      <Text className="text-[13px] font-bold text-text">{value}</Text>
    </View>
  );
}
