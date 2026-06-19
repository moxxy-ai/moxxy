import { useEffect, useMemo, useRef } from 'react';
import {
  deriveMoxxyLiveActivitySnapshot,
  deriveMoxxyLiveActivityTransition,
  planMoxxyLiveActivitySync,
  type MoxxyLiveActivityClient,
  type MoxxyLiveActivitySnapshot,
} from '../liveActivity';
import { moxxyLiveActivityClient } from '../liveActivityNative';
import { useGatewayStore } from './useGatewayStore';

const MIN_UPDATE_MS = 1500;

export function useMoxxyLiveActivity(client: MoxxyLiveActivityClient = moxxyLiveActivityClient) {
  const { chat, snapshot } = useGatewayStore();
  const previousRef = useRef<MoxxyLiveActivitySnapshot | null>(null);
  const lastSentRef = useRef<MoxxyLiveActivitySnapshot | null>(null);
  const lastSentAtRef = useRef(0);
  const pendingRef = useRef<Extract<MoxxyLiveActivitySnapshot, { readonly active: true }> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const notificationsRequestedRef = useRef(false);
  const notifiedWaitingKeyRef = useRef<string | null>(null);

  const next = useMemo(
    () => deriveMoxxyLiveActivitySnapshot({ state: snapshot, transcript: chat.items }),
    [chat.items, snapshot],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const clearPendingTimer = () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const requestNotificationsOnce = async () => {
      if (notificationsRequestedRef.current) return;
      notificationsRequestedRef.current = true;
      await client.requestNotificationAuthorization().catch(() => undefined);
    };

    const send = async (state: Extract<MoxxyLiveActivitySnapshot, { readonly active: true }>) => {
      if (!mountedRef.current) return;
      const available = await client.isAvailable().catch(() => false);
      if (!available || !mountedRef.current) return;
      await requestNotificationsOnce();
      await client.startOrUpdate(state).catch(() => undefined);
      if (state.phase === 'waiting') {
        const key = `${state.sessionId}:waiting:${state.pendingCount}`;
        if (notifiedWaitingKeyRef.current !== key) {
          notifiedWaitingKeyRef.current = key;
          await client.notifyCompletion({
            title: 'Moxxy is waiting',
            body: `${state.title} needs your decision.`,
          }).catch(() => undefined);
        }
      }
      if (!mountedRef.current) return;
      lastSentRef.current = state;
      lastSentAtRef.current = Date.now();
    };

    const schedule = (state: Extract<MoxxyLiveActivitySnapshot, { readonly active: true }>, dueAt: number) => {
      pendingRef.current = state;
      clearPendingTimer();
      timerRef.current = setTimeout(() => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        timerRef.current = null;
        if (pending) void send(pending);
      }, Math.max(0, dueAt - Date.now()));
    };

    const transition = deriveMoxxyLiveActivityTransition(previousRef.current, next, chat.items);

    if (transition.kind === 'start-or-update') {
      const plan = planMoxxyLiveActivitySync({
        lastSent: lastSentRef.current,
        next: transition.snapshot,
        now: Date.now(),
        lastSentAt: lastSentAtRef.current,
        minUpdateMs: MIN_UPDATE_MS,
      });
      if (plan.kind === 'send') {
        pendingRef.current = null;
        clearPendingTimer();
        void send(transition.snapshot);
      } else if (plan.kind === 'defer') {
        schedule(transition.snapshot, plan.dueAt);
      }
      previousRef.current = next;
      return;
    }

    if (transition.kind === 'end') {
      pendingRef.current = null;
      clearPendingTimer();
      void client.end(transition.snapshot)
        .then(() => requestNotificationsOnce())
        .then(() => client.notifyCompletion(transition.notification))
        .catch(() => undefined);
      previousRef.current = null;
      lastSentRef.current = null;
      lastSentAtRef.current = 0;
      return;
    }

    previousRef.current = next;
  }, [chat.items, client, next]);
}
