import { useCallback, useMemo } from 'react';
import { useActionCatalog, type UseChat } from '@moxxy/client-core';
import type { CompactToolMap } from '@moxxy/chat-model';
import { usePlanNext, type PlanNext } from '@/chat/modes/plan-next';

export interface FocusMiniTranscriptModel {
  readonly events: UseChat['events'];
  readonly extensions: UseChat['extensions'];
  readonly streamingText: string;
  readonly streamingReasoning: string;
  readonly sending: boolean;
  readonly isEmpty: boolean;
  readonly hasOlder: boolean;
  readonly loadOlder: () => void;
  readonly compactTools: CompactToolMap;
  /** Carries the open plan out, as the desktop conversation does; null while a turn runs. */
  readonly planNext: ((next: PlanNext) => void) | null;
}

/** Headless presentation model for the shared chat transcript in Mini Chat. */
export function useFocusMiniTranscript(
  workspaceId: string | null,
  chat: UseChat,
): FocusMiniTranscriptModel {
  const actionCatalog = useActionCatalog(workspaceId ?? undefined);
  const compactTools = useMemo<CompactToolMap>(() => {
    const compact = new Map<string, NonNullable<(typeof actionCatalog.tools)[number]['compact']>>();
    for (const tool of actionCatalog.tools) {
      if (tool.compact) compact.set(tool.name, tool.compact);
    }
    return compact;
  }, [actionCatalog.tools]);

  const send = useCallback((prompt: string): void => void chat.send(prompt), [chat.send]);
  const planNext = usePlanNext({
    workspaceId: workspaceId ?? '',
    ready: workspaceId !== null,
    busy: chat.sending || chat.activeTurnId !== null || chat.compacting,
    onSend: send,
  });

  return {
    events: chat.events,
    extensions: chat.extensions,
    streamingText: chat.streamingText,
    streamingReasoning: chat.streamingReasoning,
    sending: chat.sending,
    isEmpty: chat.isEmpty,
    hasOlder: chat.hasOlder,
    loadOlder: chat.loadOlder,
    compactTools,
    planNext,
  };
}
