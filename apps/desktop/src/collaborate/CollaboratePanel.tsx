import { useMemo, useState } from 'react';
import { api, useChat } from '@moxxy/client-core';
import { pairToolEvents, type Block, type CollaborationBlock } from '@moxxy/chat-model';
import { Icon } from '@moxxy/desktop-ui';
import { ViewHeader, ViewSwitcher, type View } from '../shell/ViewHeader';

function dotColor(status: string): string {
  if (status === 'done') return 'var(--color-green)';
  if (status === 'crashed' || status === 'killed') return 'var(--color-red)';
  if (status === 'working') return 'var(--color-primary)';
  return 'var(--color-text-dim)';
}

function taskChip(status: string): React.CSSProperties {
  const bg =
    status === 'done'
      ? 'var(--color-green)'
      : status === 'blocked'
        ? 'var(--color-amber)'
        : status === 'in_progress' || status === 'claimed'
          ? 'var(--color-primary)'
          : 'var(--color-text-dim)';
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 'var(--radius-pill)',
    color: '#fff',
    background: bg,
    flexShrink: 0,
  };
}

function latestCollab(blocks: ReadonlyArray<Block>): CollaborationBlock | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.kind === 'collab') return b;
  }
  return undefined;
}

/** The dedicated Collaborate workspace: left rail (agents · tasks · contracts),
 *  center conversation with a channel selector (# All / @agent) + a step-in
 *  composer (message a teammate or the whole team, push a directive,
 *  pause/resume). Reads the active session's folded `collab_*` stream. */
export function CollaboratePanel({
  onView,
  workspaceId,
}: {
  readonly onView: (v: View) => void;
  readonly workspaceId: string;
}): JSX.Element {
  const chat = useChat(workspaceId);
  const blocks = useMemo(() => pairToolEvents(chat.events), [chat.events]);
  const collab = useMemo(() => latestCollab(blocks), [blocks]);

  const [channel, setChannel] = useState<string>('all');
  const [text, setText] = useState('');
  const [directive, setDirective] = useState(false);

  const runCmd = async (name: string, args: string): Promise<void> => {
    await api().invoke('session.runCommand', { workspaceId, name, args }).catch(() => undefined);
  };

  const send = async (): Promise<void> => {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (directive) await runCmd('collab_direct', body);
    else await runCmd('collab_say', `${channel === 'all' ? 'all' : channel} ${body}`);
  };

  const paused = collab?.control?.paused ?? false;

  const visibleMessages = useMemo(() => {
    if (!collab) return [];
    if (channel === 'all') return collab.messages;
    return collab.messages.filter((m) => m.from === channel || m.to === channel || m.to === 'all');
  }, [collab, channel]);

  const header = (
    <ViewHeader>
      <ViewSwitcher view="collaborate" onView={onView} />
      <span
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: 'var(--color-text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 360,
        }}
      >
        {collab?.task || 'No collaboration yet'}
      </span>
      <span style={{ flex: 1 }} />
      {collab && (
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}>
          {collab.completedAtMs === null
            ? `running · ${collab.agents.filter((a) => a.status === 'done').length}/${collab.agents.length} done`
            : `done · ${collab.agents.filter((a) => a.status === 'done').length}/${collab.agents.length}`}
        </span>
      )}
    </ViewHeader>
  );

  if (!collab) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--color-text-dim)',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <Icon name="agent" size={28} />
          <div style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>No collaboration running</div>
          <div style={{ fontSize: 13, maxWidth: 420 }}>
            Go to <strong>Chat</strong>, switch the mode to <strong>collaborative</strong>, and send a task.
            A team of agents will appear here as they work.
          </div>
        </div>
      </div>
    );
  }

  const channelItems = [
    { id: 'all', label: '# All' },
    ...collab.agents.map((a) => ({ id: a.id, label: `@${a.id}` })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* LEFT RAIL — agents · tasks · contracts */}
        <aside
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: '1px solid var(--color-card-border)',
            overflowY: 'auto',
            background: 'var(--color-card-bg)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Section title={`Agents · ${collab.agents.length}`}>
            {collab.agents.map((a) => (
              <RailRow key={a.id} active={channel === a.id} onClick={() => setChannel(a.id)}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(a.status), flexShrink: 0, ...(a.status === 'working' ? { animation: 'moxxy-thinking 1.1s ease-in-out infinite' } : {}) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-dim)' }}>{a.role} · {a.status}</div>
                </span>
              </RailRow>
            ))}
          </Section>
          <Section title={`Tasks · ${collab.tasks.filter((t) => t.status === 'done').length}/${collab.tasks.length}`}>
            {collab.tasks.length === 0 && <Empty>No board items yet.</Empty>}
            {collab.tasks.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px' }}>
                <span style={taskChip(t.status)}>{t.status}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                {t.owner && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-dim)' }}>@{t.owner}</span>}
              </div>
            ))}
          </Section>
          {collab.contracts.length > 0 && (
            <Section title="Contracts">
              {collab.contracts.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px' }}>
                  <Icon name={c.status === 'change_proposed' ? 'rotate' : 'check'} size={13} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-dim)' }}>@{c.owner} v{c.version}</span>
                </div>
              ))}
            </Section>
          )}
          {collab.conflicts.length > 0 && (
            <Section title="Conflicts">
              {collab.conflicts.map((c, i) => (
                <div key={i} style={{ padding: '5px 12px', fontSize: 12, color: 'var(--color-amber-text)' }}>
                  @{c.agentId}: {c.files.join(', ')}
                </div>
              ))}
            </Section>
          )}
        </aside>

        {/* CENTER — channel selector · feed · composer */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-card-border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ChannelSelector items={channelItems} value={channel} onChange={setChannel} />
            <span style={{ flex: 1 }} />
            {collab.completedAtMs === null && (
              <button
                type="button"
                onClick={() => void runCmd(paused ? 'collab_resume' : 'collab_pause', '')}
                className="btn-chip"
                style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 600, color: paused ? 'var(--color-green)' : 'var(--color-amber-text)' }}
              >
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {channel !== 'all' && <AgentHeader agent={collab.agents.find((a) => a.id === channel)} />}
            {visibleMessages.length === 0 ? (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
                {channel === 'all' ? 'No team messages yet.' : 'No messages to or from this agent yet.'}
              </div>
            ) : (
              visibleMessages.map((m) => (
                <div key={m.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <span className="mono" style={{ fontWeight: 600, color: m.from === 'human' ? 'var(--color-accent-strong)' : 'var(--color-primary-strong)' }}>
                    {m.from}
                  </span>
                  <span className="mono" style={{ color: 'var(--color-text-dim)' }}> → {m.to}</span>
                  {m.subject ? <span className="mono" style={{ color: 'var(--color-text-dim)' }}> · {m.subject}</span> : null}
                  <span style={{ color: 'var(--color-text)' }}>: {m.body}</span>
                </div>
              ))
            )}
          </div>

          {/* Step-in composer */}
          <div style={{ borderTop: '1px solid var(--color-card-border)', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={directive ? 'Directive to the whole team…' : channel === 'all' ? 'Message the whole team…' : `Message @${channel}…`}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--color-card-border)',
                  background: 'var(--color-input-soft)',
                  fontSize: 13,
                  color: 'var(--color-text)',
                }}
              />
              <button type="button" onClick={() => void send()} className="btn-cta" style={{ padding: '8px 14px', borderRadius: 10, fontWeight: 600 }}>
                Send
              </button>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <input type="checkbox" checked={directive} onChange={(e) => setDirective(e.target.checked)} />
              Send as <strong>directive</strong> (authoritative — overrides the team's current plan)
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentHeader({ agent }: { readonly agent?: { name: string; role: string; status: string; subtask: string | null; summary: string | null } }): JSX.Element | null {
  if (!agent) return null;
  return (
    <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--color-input-soft)', marginBottom: 4 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>
        {agent.name} <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>· {agent.role} · {agent.status}</span>
      </div>
      {agent.subtask && <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{agent.subtask}</div>}
      {agent.summary && <div style={{ fontSize: 12.5, color: 'var(--color-green)', marginTop: 2 }}>✓ {agent.summary}</div>}
    </div>
  );
}

function ChannelSelector({
  items,
  value,
  onChange,
}: {
  readonly items: ReadonlyArray<{ id: string; label: string }>;
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  return (
    <nav style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'var(--color-app-bg)', borderRadius: 12, flexWrap: 'wrap' }}>
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            style={{
              padding: '5px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 9,
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              background: active ? 'var(--color-surface)' : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(15, 23, 42, 0.12)' : 'none',
            }}
          >
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ paddingBottom: 6 }}>
      <div
        style={{
          padding: '10px 12px 6px',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-dim)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function RailRow({ active, onClick, children }: { readonly active: boolean; readonly onClick: () => void; readonly children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        textAlign: 'left',
        padding: '6px 12px',
        background: active ? 'var(--color-sidebar-bg-active)' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <div style={{ padding: '4px 12px', fontSize: 12, color: 'var(--color-text-dim)', fontStyle: 'italic' }}>{children}</div>;
}
