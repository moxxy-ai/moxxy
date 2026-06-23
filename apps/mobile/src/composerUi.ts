export interface ComposerUiInput {
  readonly text: string;
  readonly sending: boolean;
  /**
   * A turn is in flight (the agent is working — thinking, running tools or
   * subagents), not just the brief send round-trip (`sending`). Drives the
   * stop/abort affordance for the WHOLE turn so a long run can be cancelled.
   * Defaults to `sending` when omitted.
   */
  readonly running?: boolean;
  readonly compacting: boolean;
  readonly actionsOpen: boolean;
  readonly autoApprove: boolean;
  readonly attachmentCount?: number;
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
  const canSubmit = (input.text.trim().length > 0 || (input.attachmentCount ?? 0) > 0) && !disabled;
  // The stop affordance follows the WHOLE turn (`running`), not just the brief
  // send round-trip (`sending`) — so a long thinking/tool/subagent run stays
  // cancellable. Falls back to `sending` for callers that don't pass `running`.
  const running = input.running ?? input.sending;
  return {
    placeholder: input.readOnly
      ? 'Archived session - select the live session to send.'
      : input.compacting
        ? 'Compacting context...'
        : 'Send a message to the agent...',
    canSubmit,
    disabled,
    sendIcon: running ? 'stop' : 'send',
    sendTone: running ? 'danger' : canSubmit ? 'primary' : 'disabled',
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
