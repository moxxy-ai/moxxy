import { useCallback, useState } from 'react';
import { useChat } from '@moxxy/client-core';
import {
  useComposerAttachments,
  type ComposerAttachment,
} from '@/chat/composer/useComposerAttachments';
import { useAttachmentImagePreviews } from '@/chat/image-preview/useAttachmentImagePreviews';
import { useImagePreview } from '@/chat/image-preview/useImagePreview';
import type { ImagePreviewItem } from '@/chat/image-preview/types';

export interface FocusMiniTextComposer {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  readonly attachmentPreviews: ReadonlyMap<string, ImagePreviewItem>;
  readonly attachError: string | null;
  readonly onPaste: ReturnType<typeof useComposerAttachments>['onPaste'];
  readonly removeAttachment: (path: string) => void;
  readonly canSubmit: boolean;
  readonly sending: boolean;
  readonly submit: () => void;
  readonly imagePreview: ReturnType<typeof useImagePreview>;
}

export function useFocusMiniTextComposer({
  workspaceId,
  focusInput,
}: {
  readonly workspaceId: string | null;
  readonly focusInput: () => void;
}): FocusMiniTextComposer {
  const [draft, setDraft] = useState('');
  const chat = useChat(workspaceId);
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

  return {
    draft,
    setDraft,
    attachments,
    attachmentPreviews,
    attachError,
    onPaste,
    removeAttachment,
    canSubmit,
    sending: chat.sending,
    submit,
    imagePreview,
  };
}
