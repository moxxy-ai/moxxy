import { createPrefSwitch } from '@/lib/pref-switch';

/** Whether Moxxy shows its own toasts in the main window. System notifications have their own switch. */
const inAppToasts = createPrefSwitch('inAppToasts');

export const useInAppToastsPreference = inAppToasts.use;
export const setInAppToastsPreference = inAppToasts.set;
export const __resetInAppToastsForTests = inAppToasts.resetForTests;
