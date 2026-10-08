import { useEffect, useMemo, useRef } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import type { AppPresence, Desk } from '@moxxy/desktop-ipc-contract';
import { planAttention } from './attention-plan';
import { bannerText } from './banner-text';
import { callsForAttention } from './calls-for-attention';
import { ringReplyChime } from './reply-chime';
import { showBanner, type Banner } from './show-banner';
import { useReplySoundPreference } from './useReplySoundPreference';
import { useSessionActivity } from './useSessionActivity';
import { useSystemNotificationsPreference } from './useSystemNotificationsPreference';

/** Assumed when the main process cannot be asked: nothing rings for the chat on screen, no banner shows. */
const IN_FRONT: AppPresence = { focused: 'main', widgetOpen: false };

/** Only the main process knows which of the app's windows has the keyboard. */
function readPresence(): Promise<AppPresence> {
  return api()
    .invoke('window.presence')
    .catch(() => IN_FRONT);
}

/**
 * Calls the person back when a chat they are not reading finishes its answer
 * or stops to ask: a chime, and a system banner once the app is in the
 * background. The chat being read stays quiet.
 */
export function useAttention({
  desks,
  mainChatId,
  activeId,
  onOpen,
  ring = ringReplyChime,
  show = showBanner,
}: {
  readonly desks: ReadonlyArray<Desk>;
  /** The chat the main window shows; null while it shows another view. */
  readonly mainChatId: string | null;
  /** The active chat, which is the one the Mini Chat shows. */
  readonly activeId: string | null;
  /** Brings the app forward on the chat a clicked banner belongs to. */
  readonly onOpen: (sessionId: string) => void;
  /** The speaker; replaced in tests, which have none. */
  readonly ring?: () => void;
  /** The system's notification centre; replaced in tests, which have none. */
  readonly show?: (banner: Banner) => void;
}): void {
  const sound = useReplySoundPreference();
  const banners = useSystemNotificationsPreference();
  const names = useMemo(
    () => new Map(desks.flatMap((desk) => desk.sessions.map((session) => [session.id, session.name] as const))),
    [desks],
  );
  const known = useMemo(() => new Set(names.keys()), [names]);
  const activity = useSessionActivity(known);
  const before = useRef(activity);
  // Read as they stand when a chat calls, without making the effect run for them.
  const now = useRef({ names, known, mainChatId, activeId, sound, banners, onOpen, ring, show });
  now.current = { names, known, mainChatId, activeId, sound, banners, onOpen, ring, show };

  // React hands over the stores once they have settled, so an answer followed at
  // once by its queued message is still "working" and does not call.
  useEffect(() => {
    const calls = callsForAttention({ before: before.current, after: activity, known: now.current.known });
    before.current = activity;
    if (calls.length === 0) return;
    const at = now.current;
    void readPresence().then((presence) => {
      const plan = planAttention({ ...at, calls, presence });
      if (plan.ring) at.ring();
      for (const call of plan.banners) {
        at.show({
          ...bannerText({
            reason: call.reason,
            name: at.names.get(call.sessionId) ?? 'Moxxy',
            events: chatStore.getChat(call.sessionId).events,
          }),
          tag: call.sessionId,
          onOpen: () => at.onOpen(call.sessionId),
        });
      }
    });
  }, [activity]);
}
