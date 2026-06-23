import { StyleSheet, Text, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { MobileIcon, type MobileIconName } from './MobileIcon';
import { Appear } from './primitives/motion';

interface SessionLoadingNoticeProps {
  readonly title: string;
  readonly body: string;
  readonly icon?: MobileIconName;
}

export function SessionLoadingNotice({
  title,
  body,
  icon = 'agent',
}: SessionLoadingNoticeProps) {
  return (
    <Appear from="up" distance={12}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <MobileIcon name={icon} size={22} strokeWidth={2.3} color={mobileSurface.accentStrong} />
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{body}</Text>
          </View>
        </View>
      </View>
    </Appear>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
    ...mobileFlat.card,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
  },
  subtitle: {
    color: mobileInk.muted,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginTop: 4,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 18,
    fontWeight: '800',
  },
});
