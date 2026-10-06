import { useCallback, useMemo, useState } from 'react';
import { useChannels } from '@moxxy/client-core';
import { ledState } from '../apps/ChannelsPanel';

export interface SidebarChannel {
  readonly id: string;
  readonly name: string;
  readonly state: ReturnType<typeof ledState>;
}

/** The Runs sidebar's "Channels" section: the bots you set up, with live state. */
export function useSidebarChannels(): {
  readonly items: ReadonlyArray<SidebarChannel>;
  readonly expanded: boolean;
  readonly toggle: () => void;
} {
  const { list } = useChannels();
  const [expanded, setExpanded] = useState(true);
  const items = useMemo(
    () =>
      list
        .filter((e) => e.status.configured)
        .map((e) => ({ id: e.descriptor.id, name: e.descriptor.name, state: ledState(e) })),
    [list],
  );
  return { items, expanded, toggle: useCallback(() => setExpanded((v) => !v), []) };
}
