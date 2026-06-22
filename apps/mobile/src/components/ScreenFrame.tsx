import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.staticContent} {...props}>
      {children}
    </View>
  );

  return (
    <AppShell>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <TopBar title={title} subtitle={subtitle} connected={connected} />
        {content}
      </SafeAreaView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  staticContent: {
    flex: 1,
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
});
