import { useEffect, useMemo, useRef } from 'react';
import { chatStore } from '@moxxy/client-core';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { planAttention } from './attention-plan';
import { bannerText } from './banner-text';
import { callsForAttention, type Call } from './calls-for-attention';
import { readPresence } from './presence';
import { pushToast } from '../notices/toast-store';
import { useInAppToastsPreference } from '../notices/useInAppToastsPreference';
import { ringReplyChime } from './reply-chime';
import { showBanner, type Banner } from './show-banner';
import { useReplySoundPreference } from './useReplySoundPreference';
import { useSessionActivity } from './useSessionActivity';
import { useSystemNotificationsPreference } from './useSystemNotificationsPreference';

/**
 * Calls the person back when a chat they are not reading finishes its answer
 * or stops to ask: a chime, with a toast while the main window is in front or
 * a system banner once the app is in the background. The chat being read stays
 * quiet.
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
  const toasts = useInAppToastsPreference();
  const names = useMemo(
    () => new Map(desks.flatMap((desk) => desk.sessions.map((session) => [session.id, session.name] as const))),
    [desks],
  );
  const known = useMemo(() => new Set(names.keys()), [names]);
  const activity = useSessionActivity(known);
  const before = useRef(activity);
  // Read as they stand when a chat calls, without making the effect run for them.
  const now = useRef({ names, known, mainChatId, activeId, sound, banners, toasts, onOpen, ring, show });
  now.current = { names, known, mainChatId, activeId, sound, banners, toasts, onOpen, ring, show };

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
      const words = (call: Call): { readonly title: string; readonly body: string } =>
        bannerText({
          reason: call.reason,
          name: at.names.get(call.sessionId) ?? 'Moxxy',
          events: chatStore.getChat(call.sessionId).events,
        });
      for (const call of plan.banners) {
        at.show({ ...words(call), tag: call.sessionId, onOpen: () => at.onOpen(call.sessionId) });
      }
      for (const call of plan.toasts) {
        pushToast({ ...words(call), id: `chat:${call.sessionId}`, tone: 'info', onOpen: () => at.onOpen(call.sessionId) });
      }
    });
  }, [activity]);
}
