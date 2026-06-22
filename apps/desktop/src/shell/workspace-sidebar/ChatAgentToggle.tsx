/**
 * The z.ai-style "Chat / Agent" toggle card at the top of the sidebar.
 *
 * It is not decoration: it drives the session's MODE. "Chat" = the `default`
 * conversational mode; "Agent" = `goal` (the autonomous loop). It reuses
 * {@link useSessionAgent} so it stays in lockstep with the composer's mode chip
 * via the shared refresh event. If the runner has no `goal` mode registered,
 * the Agent row is disabled rather than silently no-op.
 */

import { Icon, type IconName } from '@moxxy/desktop-ui';
import { useSessionAgent } from '@/chat/agent-picker/useSessionAgent';

const CHAT_MODE = 'default';
const AGENT_MODE = 'goal';

interface Item {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
}

const ITEMS: readonly Item[] = [
  { id: CHAT_MODE, label: 'Chat', icon: 'chat' },
  { id: AGENT_MODE, label: 'Agent', icon: 'agent' },
];

export function ChatAgentToggle({
  workspaceId,
  collapsed = false,
}: {
  readonly workspaceId: string;
  readonly collapsed?: boolean;
}): JSX.Element | null {
  const { info, setMode } = useSessionAgent(workspaceId);
  if (!info) return null;

  const active = info.activeMode ?? CHAT_MODE;
  const has = (id: string): boolean => id === CHAT_MODE || info.modes.includes(id);

  if (collapsed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {ITEMS.map((it) => {
          const isActive = active === it.id;
          const available = has(it.id);
          return (
            <button
              key={it.id}
              type="button"
              className="row-button"
              data-testid={`chatagent-${it.id}`}
              title={available ? it.label : `${it.label} (unavailable)`}
              disabled={!available}
              onClick={() => available && void setMode(it.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 9,
                color: isActive ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
                background: isActive ? 'var(--color-sidebar-bg-active)' : 'transparent',
                opacity: available ? 1 : 0.4,
              }}
            >
              <Icon name={it.icon} size={17} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Chat or Agent mode"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 4,
        margin: '0 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-sidebar-border)',
        borderRadius: 12,
      }}
    >
      {ITEMS.map((it) => {
        const isActive = active === it.id;
        const available = has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`chatagent-${it.id}`}
            disabled={!available}
            title={available ? undefined : `${it.label} mode is not available`}
            onClick={() => available && void setMode(it.id)}
            className="row-button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 10px',
              borderRadius: 9,
              fontSize: 13.5,
              fontWeight: isActive ? 600 : 500,
              textAlign: 'left',
              color: isActive ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
              background: isActive ? 'var(--color-sidebar-bg-active)' : 'transparent',
              opacity: available ? 1 : 0.5,
            }}
          >
            <Icon name={it.icon} size={16} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
