export interface ComposerUiInput {
  readonly text: string;
  readonly sending: boolean;
  readonly compacting: boolean;
  readonly actionsOpen: boolean;
  readonly autoApprove: boolean;
  readonly voicePhase?: 'idle' | 'recording' | 'transcribing' | 'error';
  readonly readOnly?: boolean;
}

export interface ComposerUiState {
  readonly placeholder: string;
  readonly canSubmit: boolean;
  readonly disabled: boolean;
  readonly sendIcon: 'send' | 'stop';
  readonly sendTone: 'primary' | 'danger' | 'disabled';
  readonly actionsTone: 'neutral' | 'active';
  readonly frameTone: 'neutral' | 'bypass';
  readonly bypassActive: boolean;
  readonly statusLabel: string | null;
  readonly voiceLabel: 'Voice' | 'Stop' | 'Transcribing';
  readonly voiceTone: 'neutral' | 'recording' | 'transcribing';
}

export function buildComposerUiState(input: ComposerUiInput): ComposerUiState {
  const voicePhase = input.voicePhase ?? 'idle';
  const disabled = input.compacting || input.readOnly === true || voicePhase === 'transcribing';
  const canSubmit = input.text.trim().length > 0 && !disabled;
  return {
    placeholder: input.readOnly
      ? 'Archived session - select the live session to send.'
      : input.compacting
        ? 'Compacting context...'
        : 'Send a message to the agent...',
    canSubmit,
    disabled,
    sendIcon: input.sending ? 'stop' : 'send',
    sendTone: input.sending ? 'danger' : canSubmit ? 'primary' : 'disabled',
    actionsTone: input.actionsOpen || input.autoApprove ? 'active' : 'neutral',
    frameTone: input.autoApprove ? 'bypass' : 'neutral',
    bypassActive: input.autoApprove,
    statusLabel: input.compacting
      ? 'Compacting context...'
      : voicePhase === 'recording'
        ? 'Listening...'
        : voicePhase === 'transcribing'
          ? 'Transcribing...'
          : null,
    voiceLabel: voicePhase === 'recording' ? 'Stop' : voicePhase === 'transcribing' ? 'Transcribing' : 'Voice',
    voiceTone: voicePhase === 'recording' ? 'recording' : voicePhase === 'transcribing' ? 'transcribing' : 'neutral',
  };
}
