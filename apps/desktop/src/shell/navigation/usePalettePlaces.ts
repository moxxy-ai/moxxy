import { useMemo } from 'react';
import { useChannels } from '@moxxy/client-core';
import { chordLabel } from '@/hotkeys/chordLabel';
import { listDesktopApps } from '../../apps/registry';
import type { PalettePlace } from '../../chat/command-palette/CommandPalette';
import { DESTINATIONS } from './destinations';
import { STATIC_PLACES, appPlace, channelPlace } from './places';
import { useShellNav } from './ShellNav';

const NONE: ReadonlyArray<PalettePlace> = [];

/**
 * Everything the palette can take a person to: the views, what is inside
 * them, and the channels and apps this install has. Empty outside the shell.
 */
export function usePalettePlaces(): {
  readonly places: ReadonlyArray<PalettePlace>;
  readonly onPlace: ((place: PalettePlace) => void) | undefined;
} {
  const nav = useShellNav();
  const channels = useChannels().list;
  const places = useMemo(() => {
    if (!nav) return NONE;
    return [
      ...STATIC_PLACES,
      ...channels.map((channel) => channelPlace(channel.descriptor)),
      ...listDesktopApps().map(appPlace),
    ].map((place): PalettePlace => {
      const chord = place.top ? DESTINATIONS.find((d) => d.id === place.target.destination)?.chord : undefined;
      return {
        ...place,
        disabled: nav.isDisabled(place.target.destination),
        ...(chord ? { hint: chordLabel(chord) } : {}),
      };
    });
  }, [nav, channels]);
  return { places, onPlace: nav ? (place) => nav.open(place.target) : undefined };
}
