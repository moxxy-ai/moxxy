import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useStorageState } from '@/hooks/storage';
import { ONBOARDING_STORAGE_KEY, resolveLaunchRoute } from '@/onboardingState';

export default function HomeScreen() {
  const [[loading, value]] = useStorageState(ONBOARDING_STORAGE_KEY);
  // Hold on the brand canvas until the first-run flag resolves, so we never
  // flash the chat then jump to onboarding (or vice-versa).
  if (loading) return <View style={{ flex: 1, backgroundColor: '#f1f2f9' }} />;
  return <Redirect href={resolveLaunchRoute(value)} />;
}
