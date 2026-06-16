import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAbortTurnFrame, buildRunCommandFrame, buildRunTurnFrame, buildTranscribeFrame } from '../clientFrames';
import { createComposerDraft, submitComposerDraft, updateComposerDraftText } from '../composerDraft';
import { useAttachments } from './useAttachments';
import { useVoiceRecorder } from './useVoiceRecorder';

export function useComposer(
  sendFrame: (frame: Record<string, unknown>) => void,
  options: {
    readonly workspaceId: string | null;
    readonly activeTurnId: string | null;
    readonly transcriptionId?: string | null;
    readonly transcriptionText?: string | null;
    readonly readOnly?: boolean;
  },
) {
  const [draft, setDraft] = useState(createComposerDraft);
  const text = draft.text;
  const setText = useCallback((value: string) => {
    setDraft((current) => updateComposerDraftText(current, value));
  }, []);
  const [actionsOpen, setActionsOpen] = useState(false);
  const lastTranscriptionIdRef = useRef<string | null>(null);
  const attachments = useAttachments({ disabled: options.readOnly === true });

  const voice = useVoiceRecorder({
    disabled: options.readOnly === true,
    onClip: (clip) => {
      sendFrame(buildTranscribeFrame({
        workspaceId: options.workspaceId,
        audioBase64: clip.audioBase64,
        mimeType: clip.mimeType,
      }));
    },
  });
  const { complete: completeVoiceTranscription, errorReason: voiceError, phase: voicePhase, toggle: toggleVoice } = voice;

  useEffect(() => {
    const id = options.transcriptionId ?? null;
    const transcript = options.transcriptionText?.trim();
    if (!id || id === lastTranscriptionIdRef.current) return;
    lastTranscriptionIdRef.current = id;
    if (transcript) {
      setDraft((current) => {
        const nextText = current.text.trim().length > 0 ? `${current.text.trimEnd()} ${transcript}` : transcript;
        return updateComposerDraftText(current, nextText);
      });
    }
    completeVoiceTranscription();
  }, [completeVoiceTranscription, options.transcriptionId, options.transcriptionText]);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (options.readOnly) return;
    if (!trimmed && attachments.attachments.length === 0) return;
    sendFrame(buildRunTurnFrame({
      workspaceId: options.workspaceId,
      prompt: trimmed,
      attachments: attachments.attachments,
    }));
    setDraft(submitComposerDraft);
    attachments.clearAttachments();
  }, [attachments, options.readOnly, options.workspaceId, sendFrame, text]);

  const abort = useCallback(() => {
    if (!options.activeTurnId) return;
    sendFrame(buildAbortTurnFrame({ workspaceId: options.workspaceId, turnId: options.activeTurnId }));
  }, [options.activeTurnId, options.workspaceId, sendFrame]);

  const runCommand = useCallback(
    (name: string, args = '') => {
      if (options.readOnly) return;
      sendFrame(buildRunCommandFrame({ workspaceId: options.workspaceId, name, args }));
      setActionsOpen(false);
    },
    [options.readOnly, options.workspaceId, sendFrame],
  );

  const transcribe = useCallback(() => {
    if (options.readOnly) return;
    toggleVoice();
  }, [options.readOnly, toggleVoice]);

  return {
    text,
    setText,
    inputResetKey: draft.inputResetKey,
    submit,
    abort,
    actionsOpen,
    setActionsOpen,
    runCommand,
    transcribe,
    voicePhase,
    voiceError,
    attachments: attachments.attachments,
    attachmentError: attachments.attachmentError,
    pickImageAttachment: attachments.pickImage,
    pickDocumentAttachment: attachments.pickDocument,
    pasteImageAttachment: attachments.pasteImage,
    removeAttachment: attachments.removeAttachment,
  };
}
