import type { AppPresence } from '@moxxy/desktop-ipc-contract';
import type { Call } from './calls-for-attention';

export interface AttentionPlan {
  readonly ring: boolean;
  readonly banners: ReadonlyArray<Call>;
  /** Chats that get a toast in the main window. */
  readonly toasts: ReadonlyArray<Call>;
}

/**
 * What to do about the chats that want the person back. A chat being read
 * needs nothing. Any other rings; it also gets a toast while the main window
 * has the keyboard, or a system banner once the app is in the background,
 * unless the Mini Chat is showing it there already. Each of the three has its
 * own switch.
 */
export function planAttention({
  calls,
  mainChatId,
  activeId,
  presence,
  sound,
  banners,
  toasts,
}: {
  readonly calls: ReadonlyArray<Call>;
  /** The chat the main window shows; null while it shows another view. */
  readonly mainChatId: string | null;
  /** The active chat, which is the one the Mini Chat shows. */
  readonly activeId: string | null;
  readonly presence: AppPresence;
  readonly sound: boolean;
  readonly banners: boolean;
  readonly toasts: boolean;
}): AttentionPlan {
  const read = presence.focused === 'main' ? mainChatId : presence.focused === 'widget' ? activeId : null;
  const unread = calls.filter((call) => call.sessionId !== read);
  const inWidget = presence.widgetOpen ? activeId : null;
  return {
    ring: sound && unread.length > 0,
    banners: banners && presence.focused === null ? unread.filter((call) => call.sessionId !== inWidget) : [],
    toasts: toasts && presence.focused === 'main' ? unread : [],
  };
}
