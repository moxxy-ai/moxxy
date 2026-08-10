import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { chatStore, useChat, useQueuedTurns } from '@moxxy/client-core';
import {
  useComposerAttachments,
  type ComposerAttachment,
} from '@/chat/composer/useComposerAttachments';
import { useAttachmentImagePreviews } from '@/chat/image-preview/useAttachmentImagePreviews';
import { useImagePreview } from '@/chat/image-preview/useImagePreview';
import type { ImagePreviewItem } from '@/chat/image-preview/types';

export interface FocusMiniTextComposer {
  readonly inputRef: RefObject<HTMLTextAreaElement>;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  readonly attachmentPreviews: ReadonlyMap<string, ImagePreviewItem>;
  readonly attachError: string | null;
  readonly onPaste: ReturnType<typeof useComposerAttachments>['onPaste'];
  readonly removeAttachment: (path: string) => void;
  readonly canSubmit: boolean;
  readonly sending: boolean;
  readonly canAbort: boolean;
  readonly queued: ReadonlyArray<{
    readonly key: string;
    readonly prompt: string;
    readonly onRemove: () => void;
  }>;
  readonly submit: () => void;
  readonly abort: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly imagePreview: ReturnType<typeof useImagePreview>;
}

const MAX_TEXTAREA_HEIGHT = 112;

export function useFocusMiniTextComposer({
  workspaceId,
  remoteQueuedTurns,
  onRemoveRemoteQueuedTurn,
}: {
  readonly workspaceId: string | null;
  readonly remoteQueuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
  readonly onRemoveRemoteQueuedTurn: (id: string) => void;
}): FocusMiniTextComposer {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const chat = useChat(workspaceId);
  const localQueuedTurns = useQueuedTurns(workspaceId);
  const {
    attachments,
    removeAttachment,
    clearAttachments,
    attachError,
    onPaste,
  } = useComposerAttachments(focusInput);
  const attachmentPreviews = useAttachmentImagePreviews(workspaceId ?? undefined, attachments);
  const imagePreview = useImagePreview();
  const trimmedDraft = draft.trim();
  const canSubmit =
    Boolean(workspaceId) &&
    !chat.compacting &&
    (trimmedDraft.length > 0 || attachments.length > 0);

  const submit = useCallback((): void => {
    if (!canSubmit) return;
    void chat.send(trimmedDraft, attachments.length > 0 ? attachments : undefined);
    setDraft('');
    clearAttachments();
  }, [attachments, canSubmit, chat, clearAttachments, trimmedDraft]);

  const abort = useCallback((): void => {
    void chat.abort();
  }, [chat.abort]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }, [submit]);

  const removeQueued = useCallback((id: string): void => {
    if (workspaceId) chatStore.dropFromQueue(workspaceId, id);
  }, [workspaceId]);
  const queued = useMemo(() => [
    ...localQueuedTurns.map((turn) => ({
      key: `local:${turn.id}`,
      prompt: turn.prompt,
      onRemove: () => removeQueued(turn.id),
    })),
    ...remoteQueuedTurns.map((turn) => ({
      key: `remote:${turn.id}`,
      prompt: turn.prompt,
      onRemove: () => onRemoveRemoteQueuedTurn(turn.id),
    })),
  ], [
    localQueuedTurns,
    onRemoveRemoteQueuedTurn,
    remoteQueuedTurns,
    removeQueued,
  ]);

  return {
    inputRef,
    draft,
    setDraft,
    attachments,
    attachmentPreviews,
    attachError,
    onPaste,
    removeAttachment,
    canSubmit,
    sending: chat.sending,
    canAbort: chat.activeTurnId !== null,
    queued,
    submit,
    abort,
    onKeyDown,
    imagePreview,
  };
}
