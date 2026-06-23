import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Text, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from '@/ui/kit';
import type { PairingState } from '@/hooks/usePairing';
import { buildReconnectUi } from '@/reconnectUi';

const moxxyMascot = require('../../assets/moxxy-mascot-transparent.png') as ImageSourcePropType;

// Keep reconnecting silently for this long before offering an escape hatch —
// long enough that a healthy reconnect lands first, short enough that a stale
// gateway (Mac offline, tunnel URL rotated, token revoked) doesn't strand the
// user on an endless spinner.
const ESCAPE_HATCH_DELAY_MS = 6000;

/** Shown when an already-paired device is reconnecting to its Mac. Normally a
 *  brief branded spinner, but if the stored gateway is stale the transport never
 *  opens — so after a grace period (or as soon as the bridge reports an error)
 *  we surface what's wrong and a way to re-pair / change the configuration,
 *  instead of spinning on "Connecting to your Mac…" forever. */
export function ReconnectScreen({ pairing }: { readonly pairing: PairingState }) {
  const { colors } = useTheme();
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setGraceElapsed(true), ESCAPE_HATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const { showEscapeHatch, hint } = buildReconnectUi({ graceElapsed, error: pairing.error });

  return (
    <View style={sx('flex-1 items-center justify-center px-8', { backgroundColor: colors.appBg })}>
      <View style={sx('items-center justify-center', { height: 140, width: 140 })}>
        <View style={sx('absolute rounded-full', { backgroundColor: colors.primary, height: 140, opacity: 0.1, width: 140 })} />
        <Image source={moxxyMascot} resizeMode="contain" accessibilityLabel="Moxxy" style={{ height: 122, width: 122 }} />
      </View>
      <Text style={sx('mt-6 text-[15px] font-bold text-muted text-center')} numberOfLines={1}>
        Connecting to your Mac…
      </Text>

      {showEscapeHatch ? (
        <View style={sx('mt-7 self-stretch items-center', { gap: 14 })}>
          <Text style={sx('text-[13px] font-medium text-dim text-center', { lineHeight: 19, maxWidth: 320 })}>
            {hint}
          </Text>
          <Button label="Change configuration" icon="gateway" variant="secondary" onPress={pairing.disconnect} />
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      )}
    </View>
  );
}
