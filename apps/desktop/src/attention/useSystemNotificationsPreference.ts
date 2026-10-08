import { createPrefSwitch } from '@/lib/pref-switch';

/** Whether a chat that wants the person back shows a system banner while the app is in the background. */
const systemNotifications = createPrefSwitch('systemNotifications');

export const useSystemNotificationsPreference = systemNotifications.use;
export const setSystemNotificationsPreference = systemNotifications.set;
export const __resetSystemNotificationsForTests = systemNotifications.resetForTests;
