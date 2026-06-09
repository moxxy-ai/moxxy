import { describe, expect, it } from 'vitest';
import { buildComposerUiState } from '../mobile/src/composerUi';

describe('mobile composer ui model', () => {
  it('mirrors the desktop composer affordances for an editable draft', () => {
    expect(buildComposerUiState({
      text: 'ship it',
      sending: false,
      compacting: false,
      actionsOpen: false,
      autoApprove: false,
    })).toMatchObject({
      placeholder: 'Send a message to the agent...',
      canSubmit: true,
      sendIcon: 'send',
      sendTone: 'primary',
      actionsTone: 'neutral',
      disabled: false,
    });
  });

  it('locks the prompt and swaps the primary action while compacting or sending', () => {
    expect(buildComposerUiState({
      text: 'ship it',
      sending: false,
      compacting: true,
      actionsOpen: false,
      autoApprove: false,
    })).toMatchObject({
      placeholder: 'Compacting context...',
      canSubmit: false,
      disabled: true,
    });

    expect(buildComposerUiState({
      text: '',
      sending: true,
      compacting: false,
      actionsOpen: true,
      autoApprove: true,
    })).toMatchObject({
      sendIcon: 'stop',
      sendTone: 'danger',
      actionsTone: 'active',
    });
  });

  it('shows recording and transcribing feedback while voice input is active', () => {
    expect(buildComposerUiState({
      text: '',
      sending: false,
      compacting: false,
      actionsOpen: false,
      autoApprove: true,
      voicePhase: 'recording',
    })).toMatchObject({
      statusLabel: 'Listening...',
      voiceLabel: 'Stop',
      voiceTone: 'recording',
      actionsTone: 'active',
    });

    expect(buildComposerUiState({
      text: '',
      sending: false,
      compacting: false,
      actionsOpen: false,
      autoApprove: false,
      voicePhase: 'transcribing',
    })).toMatchObject({
      statusLabel: 'Transcribing...',
      disabled: true,
      voiceLabel: 'Transcribing',
      voiceTone: 'transcribing',
    });
  });

  it('locks composer while browsing an archived session', () => {
    expect(buildComposerUiState({
      text: 'continue',
      sending: false,
      compacting: false,
      actionsOpen: false,
      autoApprove: false,
      readOnly: true,
    })).toMatchObject({
      placeholder: 'Archived session - select the live session to send.',
      canSubmit: false,
      disabled: true,
      sendTone: 'disabled',
    });
  });
});
