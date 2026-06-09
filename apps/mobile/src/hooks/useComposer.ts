import { useCallback, useEffect, useRef, useState } from 'react';
import { api, chatStore, decodeError, toErrorMessage } from '@moxxy/client-core';
import {
  buildRunCommandFrame,
  buildRunTurnFrame,
  buildTranscribeFrame,
  invokeFrame,
} from '../clientFrames';
import type { LocalFrame } from '../protocol';
import { useAttachments } from './useAttachments';
import { useVoiceRecorder } from './useVoiceRecorder';

export function useComposer(options: {
  readonly workspaceId: string | null;
  readonly activeTurnId: string | null;
  readonly transcriptionId?: string | null;
  readonly transcriptionText?: string | null;
  readonly readOnly?: boolean;
  /** client-core's queue-aware sender (text-only turns). */
  readonly send: (prompt: string) => Promise<void>;
  /** client-core's abort, bound to the active turn. */
  readonly abort: () => Promise<void>;
  readonly dispatchLocal: (frame: LocalFrame) => void;
}) {
  const [text, setText] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const lastTranscriptionIdRef = useRef<string | null>(null);
  const attachments = useAttachments({ disabled: options.readOnly === true });
  const { workspaceId, dispatchLocal } = options;

  const voice = useVoiceRecorder({
    disabled: options.readOnly === true,
    onClip: (clip) => {
      dispatchLocal({ type: 'transcribe.started' });
      void invokeFrame(
        api(),
        buildTranscribeFrame({ audioBase64: clip.audioBase64, mimeType: clip.mimeType }),
      )
        .then((transcript) => dispatchLocal({ type: 'transcribe.result', text: transcript }))
        .catch((e) => {
          // `not-supported` = the host has no transcriber — say so plainly
          // instead of surfacing a wire error.
          const decoded = decodeError(e);
          dispatchLocal({
            type: 'error',
            message:
              decoded.code === 'not-supported'
                ? 'Voice transcription is not available on this host.'
                : decoded.message,
          });
          completeVoiceTranscription();
        });
    },
  });
  const {
    complete: completeVoiceTranscription,
    errorReason: voiceError,
    phase: voicePhase,
    toggle: toggleVoice,
  } = voice;

  useEffect(() => {
    const id = options.transcriptionId ?? null;
    const transcript = options.transcriptionText?.trim();
    if (!id || id === lastTranscriptionIdRef.current) return;
    lastTranscriptionIdRef.current = id;
    if (transcript) {
      setText((draft) => (draft.trim().length > 0 ? `${draft.trimEnd()} ${transcript}` : transcript));
    }
    completeVoiceTranscription();
  }, [completeVoiceTranscription, options.transcriptionId, options.transcriptionText]);

  const sendWithAttachments = useCallback(
    async (prompt: string) => {
      if (!workspaceId) return;
      const current = chatStore.getChat(workspaceId);
      if (current.compacting) return;
      if (current.activeTurnId !== null || current.sending) {
        // Inline payloads can't ride the (path-based) turn queue — refuse
        // honestly rather than silently dropping the files.
        dispatchLocal({
          type: 'error',
          message: 'Wait for the current reply before sending attachments.',
        });
        return;
      }
      try {
        const { turnId } = await invokeFrame(
          api(),
          buildRunTurnFrame({ workspaceId, prompt, attachments: attachments.attachments }),
        );
        chatStore.dispatch(workspaceId, { type: 'send_started', turnId });
      } catch (e) {
        chatStore.dispatch(workspaceId, { type: 'send_failed', message: toErrorMessage(e) });
      }
    },
    [attachments.attachments, dispatchLocal, workspaceId],
  );

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (options.readOnly) return;
    if (!trimmed && attachments.attachments.length === 0) return;
    if (attachments.attachments.length > 0) {
      void sendWithAttachments(trimmed);
    } else {
      void options.send(trimmed);
    }
    setText('');
    attachments.clearAttachments();
  }, [attachments, options.readOnly, options.send, sendWithAttachments, text]);

  const abort = useCallback(() => {
    if (!options.activeTurnId) return;
    void options.abort();
  }, [options.abort, options.activeTurnId]);

  const runCommand = useCallback(
    (name: string, args = '') => {
      if (options.readOnly) return;
      setActionsOpen(false);
      const target = workspaceId;
      void (async () => {
        // The compaction lock mirrors the desktop composer: locked while the
        // runner summarizes, released whatever the outcome.
        if (name === 'compact' && target) chatStore.setCompacting(target, true);
        try {
          const result = await invokeFrame(
            api(),
            buildRunCommandFrame({ workspaceId: target, name, args }),
          );
          if (result.kind === 'error') {
            dispatchLocal({ type: 'error', message: result.message ?? `/${name} failed` });
          } else if (
            result.kind === 'session-action' &&
            (result.action === 'new' || result.action === 'clear') &&
            target
          ) {
            chatStore.clear(target);
          }
        } catch (e) {
          dispatchLocal({ type: 'error', message: toErrorMessage(e) });
        } finally {
          if (name === 'compact' && target) chatStore.setCompacting(target, false);
        }
      })();
    },
    [dispatchLocal, options.readOnly, workspaceId],
  );

  const transcribe = useCallback(() => {
    if (options.readOnly) return;
    toggleVoice();
  }, [options.readOnly, toggleVoice]);

  return {
    text,
    setText,
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
