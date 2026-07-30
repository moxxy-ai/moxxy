import { Icon } from '@moxxy/desktop-ui';
import { ToolChip } from './ToolChip';

interface VoiceModeButtonProps {
  readonly disabled: boolean;
  readonly onOpen: () => void;
}

/** Presentation-only entry into Voice Mode; orchestration lives in client-core. */
export function VoiceModeButton({
  disabled,
  onOpen,
}: VoiceModeButtonProps): JSX.Element {
  return (
    <ToolChip
      label="Open Voice Mode"
      onClick={onOpen}
      disabled={disabled}
    >
      <Icon name="speaker" size={15} />
    </ToolChip>
  );
}
