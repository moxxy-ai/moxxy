import { sx } from '../styles/tokens';
import { Text, View } from 'react-native';
import { MobileIcon, type MobileIconName } from './MobileIcon';

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
    <View style={sx('rounded-block border border-cardBorder bg-cardBg px-5 py-5 shadow-card', { shadowOpacity: 0.1 })}>
      <View style={sx('flex-row items-start gap-4')}>
        <View style={sx('h-11 w-11 items-center justify-center rounded-block bg-primarySoft')}>
          <MobileIcon name={icon} size={23} strokeWidth={2.35} color="#db2777" />
        </View>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[18px] font-black text-text')}>{title}</Text>
          <Text style={sx('mt-1 text-[14px] font-semibold leading-5 text-muted')}>{body}</Text>
        </View>
      </View>
    </View>
  );
}
