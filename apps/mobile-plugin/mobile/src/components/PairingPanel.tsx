import { Pressable, Text, TextInput, View } from 'react-native';

interface PairingPanelProps {
  readonly gatewayUrl: string;
  readonly code: string;
  readonly token: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onGatewayUrlChange: (value: string) => void;
  readonly onLoadPairing: () => void;
  readonly onPair: () => void;
  readonly onDisconnect: () => void;
}

export function PairingPanel(props: PairingPanelProps) {
  return (
    <View className="gap-4 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card">
      <View>
        <Text className="text-[17px] font-bold text-text">Pairing</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          Connect this phone with the LAN gateway running beside Moxxy.
        </Text>
      </View>
      <TextInput
        value={props.gatewayUrl}
        onChangeText={props.onGatewayUrlChange}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        className="min-h-11 rounded-block border border-cardBorder bg-cardBg px-3 text-[14px] text-text"
      />
      <View className="flex-row gap-2">
        <Pressable className="min-h-11 flex-1 items-center justify-center rounded-block border border-cardBorder bg-cardBg" onPress={props.onLoadPairing} disabled={props.loading}>
          <Text className="text-[13px] font-bold text-muted">Refresh code</Text>
        </Pressable>
        <Pressable className={`min-h-11 flex-1 items-center justify-center rounded-block ${props.code ? 'bg-primary' : 'bg-cardBorder'}`} onPress={props.onPair} disabled={!props.code}>
          <Text className="text-[13px] font-bold text-white">Pair</Text>
        </Pressable>
      </View>
      <View className="items-center rounded-card bg-primarySoft px-4 py-4">
        <Text className="text-[34px] font-black text-primaryStrong">{props.code || '------'}</Text>
      </View>
      {props.token ? (
        <Pressable className="min-h-10 items-center justify-center rounded-block border border-cardBorder bg-cardBg" onPress={props.onDisconnect}>
          <Text className="text-[13px] font-bold text-muted">Disconnect</Text>
        </Pressable>
      ) : null}
      {props.error ? <Text className="text-[13px] font-semibold text-red">{props.error}</Text> : null}
    </View>
  );
}
