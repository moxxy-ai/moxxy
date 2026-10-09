import { createContext, useContext, type ReactNode } from 'react';
import type { View } from '../views';
import type { DestinationId } from './destinations';
import type { PlaceTarget } from './places';

/** What the shell lets any part of the frame do about where the user is. */
export interface ShellNav {
  readonly view: View;
  readonly go: (id: DestinationId) => void;
  /** Goes to a place, showing the section it names when it names one. */
  readonly open: (target: PlaceTarget) => void;
  readonly isDisabled: (id: DestinationId) => boolean;
  readonly disabledReason: string;
  readonly showShortcuts: () => void;
  readonly openPalette: () => void;
}

const ShellNavContext = createContext<ShellNav | null>(null);

export function ShellNavProvider({
  value,
  children,
}: {
  readonly value: ShellNav;
  readonly children: ReactNode;
}): JSX.Element {
  return <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>;
}

/** Null outside the shell, so a list or a palette still renders on its own. */
export function useShellNav(): ShellNav | null {
  return useContext(ShellNavContext);
}
