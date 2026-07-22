import type { SpeechPlaybackPhase } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { ToolChip } from './ToolChip';

interface VoiceModeButtonProps {
  readonly enabled: boolean;
  readonly phase: SpeechPlaybackPhase;
  readonly onToggle: () => void;
}

/** Presentation-only Voice Mode control; orchestration lives in client-core. */
export function VoiceModeButton({
  enabled,
  phase,
  onToggle,
}: VoiceModeButtonProps): JSX.Element {
  const busy = enabled && (phase === 'synthesizing' || phase === 'speaking');
  const label = enabled ? 'Disable Voice Mode' : 'Enable Voice Mode';
  const text = !enabled
    ? 'Voice mode'
    : phase === 'synthesizing'
      ? 'Preparing…'
      : phase === 'speaking'
        ? 'Speaking…'
        : phase === 'error'
          ? 'Voice error'
          : 'Voice mode on';

  return (
    <ToolChip
      label={label}
      onClick={onToggle}
      pressed={enabled}
      tone={busy ? 'busy' : enabled ? 'armed' : 'idle'}
    >
      <Icon name="speaker" size={16} />
      <span>{text}</span>
    </ToolChip>
  );
}
