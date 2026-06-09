import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAbortTurnFrame, buildRunCommandFrame, buildRunTurnFrame, buildTranscribeFrame } from '../clientFrames';
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
  const [text, setText] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const lastTranscriptionIdRef = useRef<string | null>(null);

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
    if (transcript) setText((draft) => (draft.trim().length > 0 ? `${draft.trimEnd()} ${transcript}` : transcript));
    completeVoiceTranscription();
  }, [completeVoiceTranscription, options.transcriptionId, options.transcriptionText]);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (options.readOnly) return;
    if (!trimmed) return;
    sendFrame(buildRunTurnFrame({ workspaceId: options.workspaceId, prompt: trimmed }));
    setText('');
  }, [options.readOnly, options.workspaceId, sendFrame, text]);

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
    submit,
    abort,
    actionsOpen,
    setActionsOpen,
    runCommand,
    transcribe,
    voicePhase,
    voiceError,
  };
}
