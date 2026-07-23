import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { chatStore } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { assertDefined } from '@/lib/assert';

export interface InactiveReplyPreview {
  readonly key: string;
  readonly text: string;
}

interface AssistantPreviewCandidate {
  readonly key: string;
  readonly turnId: string;
  readonly text: string;
  readonly live: boolean;
}

interface AssistantPreviewSnapshot {
  readonly candidate: AssistantPreviewCandidate | null;
  readonly latestPromptTurnId: string | null;
}

const PREVIEW_TTL_MS = 15_000;
const EMPTY_PREVIEW_SNAPSHOT: AssistantPreviewSnapshot = Object.freeze({
  candidate: null,
  latestPromptTurnId: null,
});
const CANDIDATE_CACHE_MAX = 64;
const candidateCache = new Map<string, AssistantPreviewCandidate>();
const snapshotCache = new Map<string, {
  readonly key: string;
  readonly snapshot: AssistantPreviewSnapshot;
}>();

function compactPreviewText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function cachedCandidate(
  workspaceId: string,
  candidate: AssistantPreviewCandidate,
): AssistantPreviewCandidate {
  const cached = candidateCache.get(workspaceId);
  if (cached?.key === candidate.key && cached.text === candidate.text) {
    if (candidateCache.size > 1) {
      candidateCache.delete(workspaceId);
      candidateCache.set(workspaceId, cached);
    }
    return cached;
  }
  candidateCache.set(workspaceId, candidate);
  while (candidateCache.size > CANDIDATE_CACHE_MAX) {
    const oldest = candidateCache.keys().next().value;
    if (oldest === undefined) break;
    candidateCache.delete(oldest);
  }
  return candidate;
}

function latestPromptTurnId(events: ReadonlyArray<MoxxyEvent>): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'user_prompt') return event.turnId;
  }
  return null;
}

function readPreviewSnapshot(workspaceId: string | null): AssistantPreviewSnapshot {
  if (!workspaceId) return EMPTY_PREVIEW_SNAPSHOT;
  const snap = chatStore.getChat(workspaceId);
  const promptTurnId = latestPromptTurnId(snap.events);
  const streaming = snap.streamingText.trim();
  let candidate: AssistantPreviewCandidate | null = null;
  if (streaming) {
    candidate = cachedCandidate(workspaceId, {
      key: `stream:${snap.activeTurnId ?? 'unknown'}:${streaming.length}:${streaming.slice(-32)}`,
      turnId: snap.activeTurnId ?? promptTurnId ?? 'unknown',
      text: streaming,
      live: true,
    });
  } else {
    for (let i = snap.events.length - 1; i >= 0; i -= 1) {
      const event = snap.events[i];
      assertDefined(event, 'event index within bounds');
      if (event.type === 'user_prompt') break;
      if (event.type !== 'assistant_message') continue;
      if (event.stopReason !== 'end_turn' || !event.content.trim()) break;
      candidate = cachedCandidate(workspaceId, {
        key: `message:${event.id ?? event.turnId}:${event.content.length}`,
        turnId: event.turnId,
        text: event.content,
        live: false,
      });
      break;
    }
  }

  if (!candidate) candidateCache.delete(workspaceId);
  const snapshotKey = `${promptTurnId ?? 'none'}:${candidate?.key ?? 'none'}`;
  const cached = snapshotCache.get(workspaceId);
  if (cached?.key === snapshotKey) return cached.snapshot;
  const snapshot = { candidate, latestPromptTurnId: promptTurnId };
  snapshotCache.set(workspaceId, { key: snapshotKey, snapshot });
  return snapshot;
}

export function useInactiveReplyPreview({
  stage,
  workspaceId,
}: {
  readonly stage: string;
  readonly workspaceId: string | null;
}): {
  readonly preview: InactiveReplyPreview | null;
  readonly dismissPreview: () => void;
  readonly pinPreview: () => void;
} {
  const snapshot = useSyncExternalStore(chatStore.subscribe, () =>
    readPreviewSnapshot(workspaceId),
  );
  const candidate = snapshot.candidate;
  const [visible, setVisible] = useState(false);
  const initializedRef = useRef(false);
  const latestPromptTurnIdRef = useRef<string | null>(null);
  const eligibleTurnIdRef = useRef<string | null>(null);
  const currentCandidateRef = useRef<AssistantPreviewCandidate | null>(candidate);
  const dismissedKeyRef = useRef<string | null>(null);
  const pinnedRef = useRef(false);
  const scheduledKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  currentCandidateRef.current = candidate;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    scheduledKeyRef.current = null;
  }, []);

  const dismissPreview = useCallback(() => {
    dismissedKeyRef.current = currentCandidateRef.current?.key ?? null;
    pinnedRef.current = false;
    setVisible(false);
    clearTimer();
  }, [clearTimer]);

  const pinPreview = useCallback(() => {
    if (!currentCandidateRef.current) return;
    pinnedRef.current = true;
    dismissedKeyRef.current = null;
    setVisible(true);
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    const canShowPreview = stage === 'inactive' || stage === 'active';
    if (!canShowPreview) {
      dismissPreview();
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      latestPromptTurnIdRef.current = snapshot.latestPromptTurnId;
      if (!candidate?.live) return;
    }

    if (latestPromptTurnIdRef.current !== snapshot.latestPromptTurnId) {
      latestPromptTurnIdRef.current = snapshot.latestPromptTurnId;
      eligibleTurnIdRef.current = snapshot.latestPromptTurnId;
      dismissedKeyRef.current = null;
      pinnedRef.current = false;
      clearTimer();
      if (!candidate || candidate.turnId !== snapshot.latestPromptTurnId) {
        setVisible(false);
        return;
      }
    }

    if (!candidate) {
      pinnedRef.current = false;
      clearTimer();
      setVisible(false);
      return;
    }
    if (dismissedKeyRef.current === candidate.key) {
      return;
    }

    if (candidate.live) {
      eligibleTurnIdRef.current = candidate.turnId;
      clearTimer();
      setVisible(true);
      return;
    }

    if (eligibleTurnIdRef.current !== candidate.turnId) return;
    setVisible(true);
    if (pinnedRef.current || scheduledKeyRef.current === candidate.key) return;
    clearTimer();
    scheduledKeyRef.current = candidate.key;
    timerRef.current = setTimeout(() => {
      if (!pinnedRef.current) setVisible(false);
      timerRef.current = null;
      scheduledKeyRef.current = null;
    }, PREVIEW_TTL_MS);
  }, [candidate, clearTimer, dismissPreview, snapshot.latestPromptTurnId, stage]);

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer],
  );

  const preview = useMemo(() => {
    if (!candidate || !visible) return null;
    return { key: candidate.key, text: compactPreviewText(candidate.text) };
  }, [candidate, visible]);

  return { preview, dismissPreview, pinPreview };
}
