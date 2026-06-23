import { StyleSheet, Text, View } from 'react-native';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { MobileIcon, type MobileIconName } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
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
          <Gradient preset="brand" radius={14} style={styles.iconBadge}>
            <MobileIcon name={icon} size={23} strokeWidth={2.35} color="#ffffff" />
          </Gradient>
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
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 20,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
    ...mobileElevation.md,
  },
  iconBadge: {
    alignItems: 'center',
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
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 4,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 18,
    fontWeight: '900',
  },
});
