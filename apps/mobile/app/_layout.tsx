import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { GatewayProvider } from '@/hooks/useGatewayStore';
import { MoxxyLiveActivityController } from '@/components/MoxxyLiveActivityController';

LogBox.ignoreLogs(['props.pointerEvents is deprecated. Use style.pointerEvents']);

export default function Layout() {
  return (
    <GatewayProvider>
      <MoxxyLiveActivityController />
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#f1f2f9' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="chat" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="permissions" />
        <Stack.Screen name="goals" />
        <Stack.Screen name="scheduler" />
        <Stack.Screen name="settings" />
      </Stack>
    </GatewayProvider>
  );
}
