import { ActivityIndicator, Image, type ImageSourcePropType, Text, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;

/** Full-screen branded loader shown on launch while the persisted gateway is
 *  read from storage (and, optionally, while the transport reconnects) so the
 *  app never flashes the pairing screen for an already-paired device. */
export function SplashScreen({ label }: { readonly label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={sx('flex-1 items-center justify-center', { backgroundColor: colors.appBg })}>
      <View style={sx('items-center justify-center', { height: 140, width: 140 })}>
        <View style={sx('absolute rounded-full', { backgroundColor: colors.primary, height: 140, opacity: 0.1, width: 140 })} />
        <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy" style={{ height: 122, width: 122 }} />
      </View>
      {label ? <Text style={sx('mt-6 text-[15px] font-bold text-muted text-center')} numberOfLines={1}>{label}</Text> : null}
      <ActivityIndicator color={colors.primary} style={{ marginTop: label ? 16 : 24 }} />
    </View>
  );
}
