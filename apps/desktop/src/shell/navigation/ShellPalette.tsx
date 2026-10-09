import { CommandPalette } from '../../chat/command-palette/CommandPalette';
import type { CommandInfo } from '../../chat/command-palette/types';
import { usePalettePlaces } from './usePalettePlaces';

/**
 * The ⌘K palette as the shell opens it: every place it can go to, plus the
 * actions of the run. Mounted only while it is open, so what it lists is read
 * then and not kept warm behind every view.
 */
export function ShellPalette({
  workspaceId,
  onClose,
  command,
}: {
  readonly workspaceId: string;
  readonly onClose: () => void;
  /** An action already picked elsewhere (the composer's slash menu). */
  readonly command?: CommandInfo;
}): JSX.Element {
  const { places, onPlace } = usePalettePlaces();
  return (
    <CommandPalette
      workspaceId={workspaceId}
      places={places}
      {...(onPlace ? { onPlace } : {})}
      {...(command ? { command } : {})}
      onClose={onClose}
    />
  );
}
