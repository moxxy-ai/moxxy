import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Onboarding } from '@/components/Onboarding';
import { setStorageItemAsync } from '@/hooks/storage';
import { ONBOARDING_DONE_VALUE, ONBOARDING_STORAGE_KEY } from '@/onboardingState';

export default function OnboardingScreen() {
  const router = useRouter();
  const handleDone = useCallback(() => {
    void setStorageItemAsync(ONBOARDING_STORAGE_KEY, ONBOARDING_DONE_VALUE);
    router.replace('/chat');
  }, [router]);
  return <Onboarding onDone={handleDone} />;
}
