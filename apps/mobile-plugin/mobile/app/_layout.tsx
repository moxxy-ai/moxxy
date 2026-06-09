import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { GatewayProvider } from '@/hooks/useGatewayStore';
import '../global.css';

LogBox.ignoreLogs(['props.pointerEvents is deprecated. Use style.pointerEvents']);

export default function Layout() {
  return (
    <GatewayProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#f1f2f9' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="permissions" />
        <Stack.Screen name="goals" />
        <Stack.Screen name="settings" />
      </Stack>
    </GatewayProvider>
  );
}
