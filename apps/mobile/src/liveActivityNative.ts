import { NativeModules, Platform } from 'react-native';
import { createMoxxyLiveActivityClient, type MoxxyLiveActivityNativeModule } from './liveActivity';

const nativeModule = (NativeModules as Record<string, unknown>).MoxxyLiveActivity as
  | MoxxyLiveActivityNativeModule
  | undefined;

export const moxxyLiveActivityClient = createMoxxyLiveActivityClient({
  nativeModule: nativeModule ?? null,
  platformOS: Platform.OS,
});
