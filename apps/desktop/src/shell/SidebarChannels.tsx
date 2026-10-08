import { Icon } from '@moxxy/desktop-ui';
import { useSidebarChannels, type SidebarChannel } from './useSidebarChannels';

/** "Channels" in the Runs sidebar — presentational; state lives in `useSidebarChannels`. */
export function SidebarChannels({
  items,
  expanded,
  onToggle,
  onOpen,
}: {
  readonly items: ReadonlyArray<SidebarChannel>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onOpen: (channelId: string) => void;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section data-testid="sidebar-channels" className="sidebar-channels">
      <button
        type="button"
        className="run-section__head sidebar-channels__head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="run-section__chevron" data-open={expanded} aria-hidden>
          <Icon name="chevron-right" size={12} />
        </span>
        <span className="run-section__name">Channels</span>
        <span className="run-section__count" aria-hidden>
          {items.length}
        </span>
      </button>
      {expanded && (
        <ul className="run-section__rows">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="sidebar-channel"
                onClick={() => onOpen(c.id)}
                data-testid={`sidebar-channel-${c.id}`}
              >
                <span className="sidebar-channel__icon" aria-hidden>
                  <Icon name="broadcast" size={15} />
                </span>
                <span className="sidebar-channel__name">{c.name}</span>
                <span className="led" data-state={c.state} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Binds the section to its hook (kept out of WorkspaceSidebar so the tree
 *  doesn't load channels unless the shell can navigate to them). */
export function SidebarChannelsSection({ onOpen }: { readonly onOpen: (channelId: string) => void }): JSX.Element | null {
  const channels = useSidebarChannels();
  return (
    <SidebarChannels items={channels.items} expanded={channels.expanded} onToggle={channels.toggle} onOpen={onOpen} />
  );
}
