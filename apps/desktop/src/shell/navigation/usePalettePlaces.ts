import { useMemo } from 'react';
import { chordLabel } from '@/hotkeys/chordLabel';
import type { PalettePlace } from '../../chat/command-palette/CommandPalette';
import { DESTINATIONS, type DestinationId } from './destinations';
import { useShellNav } from './ShellNav';

const NONE: ReadonlyArray<PalettePlace> = [];

/** The shell's places, in the shape the command palette lists them. Empty outside the shell. */
export function usePalettePlaces(): {
  readonly places: ReadonlyArray<PalettePlace>;
  readonly onPlace: ((id: DestinationId) => void) | undefined;
} {
  const nav = useShellNav();
  const places = useMemo(
    () =>
      nav
        ? DESTINATIONS.map((d) => ({
            id: d.id,
            label: d.label,
            icon: d.icon,
            disabled: nav.isDisabled(d.id),
            hint: d.chord ? chordLabel(d.chord) : undefined,
          }))
        : NONE,
    [nav],
  );
  return { places, onPlace: nav ? nav.go : undefined };
}
