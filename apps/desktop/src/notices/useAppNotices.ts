import { useEffect, useRef } from 'react';
import { api } from '@moxxy/client-core';
import type { AppNotice } from '@moxxy/desktop-ipc-contract';
import { readPresence } from '../attention/presence';
import { showBanner, type Banner } from '../attention/show-banner';
import { useSystemNotificationsPreference } from '../attention/useSystemNotificationsPreference';
import { noticePlace, type SectionTarget } from '../shell/navigation/places';
import { pushToast } from './toast-store';
import { useInAppToastsPreference } from './useInAppToastsPreference';

/**
 * Tells the person about work the host finished in the background, such as a
 * model download: a toast while the main window is in front, a system
 * notification otherwise. Each has its own switch; with toasts off a notice
 * that arrives while the app is in front shows nothing.
 */
export function useAppNotices({
  onOpen,
  show = showBanner,
}: {
  /** Brings the app forward on the place a notice is about. */
  readonly onOpen: (target: SectionTarget) => void;
  /** The system's notification centre; replaced in tests, which have none. */
  readonly show?: (banner: Banner) => void;
}): void {
  const banners = useSystemNotificationsPreference();
  const toasts = useInAppToastsPreference();
  // Read as they stand when a notice arrives, without re-subscribing for them.
  const now = useRef({ onOpen, show, banners, toasts });
  now.current = { onOpen, show, banners, toasts };

  useEffect(
    () =>
      api().subscribe('app.notice', (notice: AppNotice) => {
        const place = notice.target ? noticePlace(notice.target) : null;
        const open = place ? () => now.current.onOpen(place) : undefined;
        void readPresence().then((presence) => {
          const at = now.current;
          if (presence.focused === 'main') {
            if (!at.toasts) return;
            pushToast({
              id: notice.id,
              tone: notice.tone,
              title: notice.title,
              ...(notice.body ? { body: notice.body } : {}),
              ...(open ? { onOpen: open } : {}),
            });
          } else if (at.banners) {
            at.show({ title: notice.title, body: notice.body ?? '', tag: notice.id, onOpen: open ?? (() => undefined) });
          }
        });
      }),
    [],
  );
}
