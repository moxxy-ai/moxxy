import { createPrefSwitch } from '@/lib/pref-switch';

/** Whether a chat that wants the person back rings. */
const replySound = createPrefSwitch('replySound');

export const useReplySoundPreference = replySound.use;
export const setReplySoundPreference = replySound.set;
export const __resetReplySoundForTests = replySound.resetForTests;
