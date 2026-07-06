import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { chatStore } from '@moxxy/client-core';
import { assertDefined } from '@/lib/assert';

export interface InactiveReplyPreview {
  readonly text: string;
}

interface AssistantPreviewCandidate {
  readonly key: string;
  readonly text: string;
  readonly live: boolean;
}

const PREVIEW_TTL_MS = 8_000;
const CANDIDATE_CACHE_MAX = 64;
const candidateCache = new Map<string, AssistantPreviewCandidate>();

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

function latestAssistantCandidate(workspaceId: string | null): AssistantPreviewCandidate | null {
  if (!workspaceId) return null;
  const snap = chatStore.getChat(workspaceId);
  const streaming = snap.streamingText.trim();
  if (streaming) {
    return cachedCandidate(workspaceId, {
      key: `stream:${snap.activeTurnId ?? 'unknown'}:${streaming.length}:${streaming.slice(-32)}`,
      text: streaming,
      live: true,
    });
  }
  for (let i = snap.events.length - 1; i >= 0; i--) {
    const event = snap.events[i];
    assertDefined(event, 'event index within bounds');
    if (event.type !== 'assistant_message' || !event.content.trim()) continue;
    return cachedCandidate(workspaceId, {
      key: `message:${event.id ?? event.turnId}:${event.content.length}`,
      text: event.content,
      live: false,
    });
  }
  candidateCache.delete(workspaceId);
  return null;
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
} {
  const candidate = useSyncExternalStore(chatStore.subscribe, () =>
    latestAssistantCandidate(workspaceId),
  );
  const [visible, setVisible] = useState(false);
  const consumedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissPreview = useCallback(() => {
    setVisible(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    const canShowPreview = stage === 'inactive' || stage === 'active';
    if (!canShowPreview) {
      consumedKeyRef.current = candidate?.key ?? consumedKeyRef.current;
      dismissPreview();
      return;
    }
    if (!candidate) {
      dismissPreview();
      return;
    }
    if (consumedKeyRef.current === candidate.key && !visible) {
      return;
    }

    const shouldShow = candidate.live || consumedKeyRef.current !== null;
    consumedKeyRef.current = candidate.key;
    if (!shouldShow) return;

    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, PREVIEW_TTL_MS);
  }, [candidate, dismissPreview, stage, visible]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const preview = useMemo(() => {
    if (!candidate || !visible) return null;
    return { text: compactPreviewText(candidate.text) };
  }, [candidate, visible]);

  return { preview, dismissPreview };
}
