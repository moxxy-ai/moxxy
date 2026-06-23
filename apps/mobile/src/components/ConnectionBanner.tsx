import { Text, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card } from '@/ui/kit';
import type { ConnectionBannerCopy } from '@/connectionState';

/** Inline, non-blocking notice shown at the top of the transcript when the
 *  bridge to the Mac isn't open. Replaces the old full-screen "Connecting to
 *  your Mac…" gate: the rest of the app (drawer, account, composer) stays
 *  usable, and the user always has a Reconnect / settings path right here. */
export function ConnectionBanner({
  banner,
  onReconnect,
  onOpenSettings,
}: {
  readonly banner: ConnectionBannerCopy;
  readonly onReconnect: () => void;
  readonly onOpenSettings: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card>
      <Text style={sx('text-[16px] font-black text-text', { letterSpacing: -0.2 })}>{banner.title}</Text>
      <Text style={sx('mt-1 text-[13px] font-medium text-muted', { lineHeight: 19 })}>{banner.body}</Text>

      {banner.steps.length > 0 ? (
        <View style={sx('mt-3', { gap: 8 })}>
          {banner.steps.map((step, index) => (
            <View key={step} style={sx('flex-row items-center', { gap: 10 })}>
              <View style={sx('items-center justify-center rounded-full', { backgroundColor: colors.primarySoft, height: 22, width: 22 })}>
                <Text style={sx('text-[11px] font-black text-primary')}>{index + 1}</Text>
              </View>
              <Text style={sx('flex-1 text-[13px] font-medium text-text', { lineHeight: 18 })}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={sx('mt-4 flex-row', { gap: 10 })}>
        <View style={sx('flex-1')}>
          <Button label="Reconnect" icon="refresh" size="md" onPress={onReconnect} />
        </View>
        <View style={sx('flex-1')}>
          <Button label="Settings" icon="gateway" variant="secondary" size="md" onPress={onOpenSettings} />
        </View>
      </View>
    </Card>
  );
}
