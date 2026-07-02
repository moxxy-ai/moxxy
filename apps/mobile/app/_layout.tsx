import { Stack } from 'expo-router';
import { LogBox } from 'react-native';
import { GatewayProvider } from '@/hooks/useGatewayStore';
import { MoxxyLiveActivityController } from '@/components/MoxxyLiveActivityController';
import { ThemeProvider, ThemedStatusBar, useTheme } from '@/theme/ThemeProvider';

LogBox.ignoreLogs(['props.pointerEvents is deprecated. Use style.pointerEvents']);

export default function Layout() {
  return (
    <ThemeProvider>
      <GatewayProvider>
        <MoxxyLiveActivityController />
        <ThemedStatusBar />
        <RootStack />
      </GatewayProvider>
    </ThemeProvider>
  );
}

function RootStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.appBg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="apps" />
      <Stack.Screen name="account" />
      <Stack.Screen name="workflows" />
      <Stack.Screen name="scheduler" />
    </Stack>
  );
}
