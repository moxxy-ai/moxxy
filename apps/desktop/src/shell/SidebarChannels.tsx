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
    <section data-testid="sidebar-channels" style={{ marginTop: 'var(--space-12)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: 'var(--space-4) var(--space-6)',
          background: 'none',
          border: 'none',
          color: 'var(--color-text-dim)',
          fontSize: 'var(--type-label)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'inline-flex', transform: expanded ? 'rotate(90deg)' : 'none' }}>
          <Icon name="chevron-right" size={12} />
        </span>
        Channels
      </button>
      {expanded && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                data-testid={`sidebar-channel-${c.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: 'var(--space-4) var(--space-6) var(--space-4) var(--space-20)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text)',
                  fontSize: 'var(--type-row)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span className="led" data-state={c.state} aria-hidden />
                {c.name}
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
