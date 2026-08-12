import { useChat } from '@moxxy/client-core';
import { useFocusMiniTextComposer } from './useFocusMiniTextComposer';
import { useFocusMiniTranscript } from './useFocusMiniTranscript';

export function useFocusMiniTextModel({
  workspaceId,
  remoteQueuedTurns,
  onRemoveRemoteQueuedTurn,
}: {
  readonly workspaceId: string | null;
  readonly remoteQueuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
  readonly onRemoveRemoteQueuedTurn: (id: string) => void;
}) {
  const chat = useChat(workspaceId);
  const transcript = useFocusMiniTranscript(workspaceId, chat);
  const composer = useFocusMiniTextComposer({
    workspaceId,
    remoteQueuedTurns,
    onRemoveRemoteQueuedTurn,
    chat,
  });

  return { transcript, composer } as const;
}
