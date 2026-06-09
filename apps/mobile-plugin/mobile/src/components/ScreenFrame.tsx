import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppShell } from './AppShell';
import { TopBar } from './TopBar';

interface ScreenFrameProps extends ViewProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly connected?: boolean;
  readonly pendingActions?: number;
  readonly scroll?: boolean;
}

export function ScreenFrame({
  children,
  title,
  subtitle,
  connected,
  pendingActions: _pendingActions,
  scroll = true,
  ...props
}: ScreenFrameProps) {
  const content = scroll ? (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 py-4">
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1 gap-4 px-4 py-4" {...props}>
      {children}
    </View>
  );

  return (
    <AppShell>
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <TopBar title={title} subtitle={subtitle} connected={connected} />
        {content}
      </SafeAreaView>
    </AppShell>
  );
}
