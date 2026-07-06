import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { CollabRunSummary } from '@moxxy/desktop-ipc-contract';
import type { ApprovalDecision } from '@moxxy/sdk';
import { pairToolEvents } from '@moxxy/chat-model';
import type { CollabMsgView, CollabTaskView } from '@moxxy/chat-model';
import { Button, Icon } from '@moxxy/desktop-ui';
import { ViewHeader, ViewSwitcher, type View } from '../shell/ViewHeader';
import { useFocusTrap } from '../chat/useFocusTrap';
import { useCollab, type CollabApproval } from './useCollab';
import { dotColor, filterCollabMessages, latestCollab, taskChipBg } from './collab-view';

function taskChip(status: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 'var(--radius-pill)',
    color: '#fff',
    background: taskChipBg(status),
    flexShrink: 0,
  };
}

/** The dedicated Collaborate workspace: left rail (agents · tasks · contracts),
 *  center conversation with a channel selector (# All / @agent) + a step-in
 *  composer (message a teammate or the whole team, push a directive,
 *  pause/resume). Reads the active session's folded `collab_*` stream. */
export function CollaboratePanel({
  onView,
  workspaceId,
  disabledViews,
  disabledViewReason,
}: {
  readonly onView: (v: View) => void;
  readonly workspaceId: string;
  readonly disabledViews?: ReadonlyArray<View>;
  readonly disabledViewReason?: string;
}): JSX.Element {
  // The coordinator runs on its OWN dedicated runner (never this workspace's chat
  // session); useCollab reads its live stream + roster-approval checkpoint.
  const coord = useCollab(workspaceId);
  const blocks = useMemo(() => pairToolEvents(coord.events), [coord.events]);
  const collab = useMemo(() => latestCollab(blocks), [blocks]);

  const [channel, setChannel] = useState<string>('all');
  const [text, setText] = useState('');
  const [directive, setDirective] = useState(false);
  const [goal, setGoal] = useState('');
  const [starting, setStarting] = useState(false);
  const [forceStart, setForceStart] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CollabRunSummary[] | null>(null);
  const [globalActive, setGlobalActive] = useState<{ active: boolean; task?: string } | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  // Poll the global single-flight lock so Start reflects a collaboration running
  // in ANY workspace (only one runs at a time). Self-scheduling (not setInterval)
  // so a wedged/disconnected runner backs off (2.5s → cap 30s) instead of firing
  // every 2.5s forever, and so two consecutive failures degrade the UI to an
  // "unknown" state (globalActive = null) rather than pinning stale data. The
  // backoff resets on the first success; polling pauses while the tab is hidden.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 2500;
    let failures = 0;
    const BASE_DELAY = 2500;
    const MAX_DELAY = 30_000;

    const schedule = (): void => {
      if (!alive) return;
      timer = setTimeout(run, document.hidden ? MAX_DELAY : delay);
    };
    const run = (): void => {
      void api()
        .invoke('collab.active')
        .then((r) => {
          if (!alive) return;
          failures = 0;
          delay = BASE_DELAY;
          setGlobalActive(r);
        })
        .catch(() => {
          if (!alive) return;
          failures += 1;
          // Don't trust stale data through a sustained outage: after two
          // consecutive failures, drop to "unknown" so the UI degrades visibly.
          if (failures >= 2) setGlobalActive(null);
          delay = Math.min(MAX_DELAY, delay * 2);
        })
        .finally(schedule);
    };

    run();
    const onVisible = (): void => {
      if (!document.hidden && alive) {
        if (timer) clearTimeout(timer);
        run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspaceId]);

  // Step-in on the COORDINATOR session (not a chat session).
  const runCmd = async (name: string, args: string): Promise<void> => {
    await coord.command(name, args);
  };

  const running = collab != null && collab.completedAtMs === null;

  // Start a collaboration on the DEDICATED coordinator runner. No chat session is
  // mode-switched or written to. The global single-flight lock (runner side)
  // guarantees only one runs at a time.
  const startCollaboration = async (): Promise<void> => {
    const g = goal.trim();
    if (!g || starting) return;
    setStarting(true);
    setGoal('');
    try {
      await coord.start(g, workspaceId);
      setForceStart(false);
    } catch {
      // surfaced as an error/assistant message on the coordinator's own log
    } finally {
      setStarting(false);
    }
  };

  // End the current collaboration for good: stops the coordinator (its finally
  // archives the run + cleans up) and force-releases the global lock, so a new
  // one can start — even if the current run is wedged or the lock is stale.
  const endCollaboration = async (): Promise<void> => {
    if (ending) return;
    setEnding(true);
    try {
      await coord.end();
      const r = await api().invoke('collab.active').catch(() => null);
      setGlobalActive(r);
      setForceStart(true); // drop to the start composer for a fresh run
    } catch {
      // best-effort
    } finally {
      setEnding(false);
    }
  };

  const loadHistory = async (): Promise<void> => {
    const runs = await api().invoke('collab.history', { limit: 50 }).catch(() => []);
    // The payload originates from a JSON run archive on disk; a corrupted /
    // truncated entry (agents undefined, merge present but merged missing) would
    // otherwise throw during render and crash the whole Collaborate view. Narrow
    // each entry defensively so one bad archive degrades to an empty-ish card.
    setHistory(Array.isArray(runs) ? runs.map(normalizeRun) : []);
  };

  const send = async (): Promise<void> => {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (directive) await runCmd('collab_direct', body);
    else await runCmd('collab_say', `${channel === 'all' ? 'all' : channel} ${body}`);
  };

  const control = collab?.control;
  const paused = control?.paused ?? false;

  const visibleMessages = useMemo(
    () => (collab ? filterCollabMessages(collab.messages, channel) : []),
    [collab, channel],
  );

  const header = (
    <ViewHeader>
      <ViewSwitcher
        view="collaborate"
        onView={onView}
        disabledViews={disabledViews}
        disabledReason={disabledViewReason}
      />
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
      <button
        type="button"
        onClick={() => {
          const next = !showHistory;
          setShowHistory(next);
          if (next) void loadHistory();
        }}
        className="btn-chip"
        style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 600, ...(showHistory ? { color: 'var(--color-primary)' } : {}) }}
        title="Past collaborations"
      >
        History
      </button>
      {(running || globalActive?.active) && (
        <button
          type="button"
          onClick={() => void endCollaboration()}
          disabled={ending}
          className="btn-chip"
          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 600, color: 'var(--color-red)' }}
          title="Stop the team for good and archive this run"
          aria-label="End and archive this collaboration"
        >
          {ending ? 'Ending…' : <><span aria-hidden>■</span> End &amp; archive</>}
        </button>
      )}
      {collab && !running && !forceStart && !globalActive?.active && (
        <button
          type="button"
          onClick={() => setForceStart(true)}
          className="btn-chip"
          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 600 }}
          aria-label="Start a new collaboration"
        >
          <span aria-hidden>＋</span> New
        </button>
      )}
    </ViewHeader>
  );

  if (showHistory) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        <CollabHistory runs={history} onClose={() => setShowHistory(false)} />
      </div>
    );
  }

  if (!collab || forceStart) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        {coord.approval && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-card-border)' }}>
            <CollabApprovalCard approval={coord.approval} onRespond={coord.respondApproval} />
          </div>
        )}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--color-primary)',
              background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
            }}
          >
            <Icon name="agent" size={26} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 19, color: 'var(--color-text)' }}>
              Start a collaboration
            </div>
            <div style={{ fontSize: 13, maxWidth: 460, color: 'var(--color-text-dim)', lineHeight: 1.55 }}>
              Describe a goal and a team of agents — an architect plus implementers — will plan it,
              propose a roster for you to approve, then build it in parallel. Only one collaboration
              runs at a time.
            </div>
          </div>
          {globalActive?.active && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--color-amber-text)',
                maxWidth: 520,
                background: 'color-mix(in srgb, var(--color-amber) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)',
                borderRadius: 10,
                padding: '8px 12px',
                lineHeight: 1.5,
              }}
            >
              A collaboration is already running{globalActive.task ? ` ("${globalActive.task}")` : ''}. Only one
              runs at a time to save resources — wait for it to finish, or
              {' '}
              <button
                type="button"
                onClick={() => void endCollaboration()}
                disabled={ending}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-red)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {ending ? 'ending…' : 'end & archive it now'}
              </button>
              .
            </div>
          )}
          <StartComposer
            goal={goal}
            setGoal={setGoal}
            starting={starting}
            blocked={globalActive?.active ?? false}
            onStart={() => void startCollaboration()}
          />
          {collab && (
            <button
              type="button"
              onClick={() => setForceStart(false)}
              className="btn-ghost"
              style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 8, color: 'var(--color-text-muted)' }}
            >
              ← Back to the current team
            </button>
          )}
        </div>
      </div>
    );
  }

  const channelItems = [
    { id: 'all', label: '# All' },
    ...collab.agents.map((a) => ({ id: a.id, label: `@${a.id}` })),
  ];

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {header}
      {coord.approval && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-card-border)' }}>
          <CollabApprovalCard approval={coord.approval} onRespond={coord.respondApproval} />
        </div>
      )}
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
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTask(t.id)}
                title="Show details"
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px' }}
              >
                <span style={taskChip(t.status)}>{t.status}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)' }}>{t.title}</span>
                {t.paths && t.paths.length > 0 && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{t.paths.length}📄</span>
                )}
                {t.owner && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-dim)' }}>@{t.owner}</span>}
              </button>
            ))}
          </Section>
          {(() => {
            const files = [...new Set(collab.tasks.flatMap((t) => t.paths ?? []))];
            return files.length > 0 ? (
              <Section title={`Deliverables · ${files.length}`}>
                {files.map((f) => (
                  <div key={f} className="mono" style={{ padding: '3px 12px', fontSize: 11.5, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
                ))}
              </Section>
            ) : null;
          })()}
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
                aria-label={paused ? 'Resume the team' : 'Pause the team'}
              >
                {paused ? <><span aria-hidden>▶</span> Resume</> : <><span aria-hidden>⏸</span> Pause</>}
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
              visibleMessages.map((m) => <MessageCard key={m.id} m={m} />)
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
                aria-label={directive ? 'Directive to the whole team' : channel === 'all' ? 'Message the whole team' : `Message @${channel}`}
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
      {selectedTask && (
        <TaskModal
          task={collab.tasks.find((t) => t.id === selectedTask)}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

/** The coordinator's roster-approval checkpoint — the single human gate in a
 *  collaboration. Rendered inline in the Collaborate panel (never the chat ask
 *  sheet) and answered via `collab.respondApproval`. */
function CollabApprovalCard({
  approval,
  onRespond,
}: {
  readonly approval: CollabApproval;
  readonly onRespond: (requestId: string, decision: ApprovalDecision) => void;
}): JSX.Element {
  const { request, requestId } = approval;
  const [text, setText] = useState('');
  const textOption = request.options.find((o) => o.requestsText);
  return (
    <div
      role="group"
      aria-label={request.title}
      style={{
        border: '1px solid var(--color-primary)',
        borderRadius: 12,
        padding: 14,
        background: 'color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text)' }}>{request.title}</div>
      {request.body && (
        <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {request.body}
        </div>
      )}
      {textOption && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={textOption.textPrompt || 'Add a note…'}
          rows={2}
          style={{
            resize: 'vertical',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--color-card-border)',
            background: 'var(--color-input-soft)',
            fontSize: 13,
            color: 'var(--color-text)',
            fontFamily: 'inherit',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {request.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={opt.danger ? 'btn-chip' : 'btn-cta'}
            onClick={() =>
              onRespond(requestId, {
                optionId: opt.id,
                ...(opt.requestsText && text.trim() ? { text: text.trim() } : {}),
              })
            }
            title={opt.description}
            style={{ padding: '6px 14px', borderRadius: 9, fontWeight: 600, ...(opt.danger ? { color: 'var(--color-red)' } : {}) }}
          >
            {opt.label}
          </button>
        ))}
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

const COLLAB_EXAMPLES = [
  'Add a CSV export feature with tests and docs',
  'Refactor the auth module into smaller files',
  'Add dark-mode support across the settings screens',
];

function StartComposer({
  goal,
  setGoal,
  starting,
  blocked,
  onStart,
}: {
  readonly goal: string;
  readonly setGoal: (v: string) => void;
  readonly starting: boolean;
  readonly blocked: boolean;
  readonly onStart: () => void;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const disabled = starting || blocked || goal.trim().length === 0;
  return (
    <div style={{ width: '100%', maxWidth: 580, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Composer card — the textarea + actions read as one surface (focus ring
       *  on the whole card), matching the chat composer rather than a bare box. */}
      <div
        style={{
          border: `1px solid ${focused ? 'var(--color-primary)' : 'var(--color-card-border)'}`,
          borderRadius: 16,
          background: 'var(--color-surface)',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          textAlign: 'left',
          boxShadow: focused
            ? '0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent)'
            : '0 1px 3px rgba(0, 0, 0, 0.18)',
          transition: 'border-color 120ms, box-shadow 120ms',
        }}
      >
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!disabled) onStart();
            }
          }}
          autoFocus
          aria-label="Describe what the team should build"
          placeholder="Describe what the team should build…"
          rows={3}
          style={{
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 14,
            lineHeight: 1.55,
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            minHeight: 68,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}>
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to start
          </span>
          <Button
            variant="cta"
            onClick={onStart}
            disabled={disabled}
            style={{ padding: '8px 18px', borderRadius: 10, opacity: disabled ? 0.55 : 1 }}
          >
            {starting ? 'Starting…' : 'Start collaboration'}
          </Button>
        </div>
      </div>
      {/* Quick-start examples — click to fill the goal. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {COLLAB_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="btn-chip"
            onClick={() => setGoal(ex)}
            style={{
              fontSize: 12,
              padding: '5px 11px',
              borderRadius: 999,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function Kbd({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <kbd
      style={{
        display: 'inline-block',
        minWidth: 16,
        textAlign: 'center',
        padding: '1px 4px',
        margin: '0 2px',
        fontSize: 10.5,
        fontFamily: 'inherit',
        color: 'var(--color-text-muted)',
        background: 'var(--color-app-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 5,
      }}
    >
      {children}
    </kbd>
  );
}

function outcomeChip(outcome: string): React.CSSProperties {
  const bg =
    outcome === 'completed'
      ? 'var(--color-green)'
      : outcome === 'aborted'
        ? 'var(--color-amber)'
        : 'var(--color-red)';
  return { fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-pill)', color: '#fff', background: bg, flexShrink: 0 };
}

function whenAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Coerce one archived run into a render-safe shape. The archive lives on disk
 * and is untrusted at the renderer boundary, so every field a render path
 * dereferences gets a typed default (arrays default to [], numbers to 0). An
 * outright non-object entry collapses to a placeholder rather than throwing.
 */
export function normalizeRun(raw: unknown): CollabRunSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CollabRunSummary>;
  const merge = r.merge && typeof r.merge === 'object' ? r.merge : undefined;
  return {
    runId: typeof r.runId === 'string' ? r.runId : `run-${Math.random().toString(36).slice(2)}`,
    task: typeof r.task === 'string' ? r.task : '(untitled)',
    startedAtMs: typeof r.startedAtMs === 'number' ? r.startedAtMs : 0,
    finishedAtMs: typeof r.finishedAtMs === 'number' ? r.finishedAtMs : 0,
    outcome:
      r.outcome === 'completed' || r.outcome === 'aborted' || r.outcome === 'failed'
        ? r.outcome
        : 'failed',
    parallel: Boolean(r.parallel),
    gitRepo: Boolean(r.gitRepo),
    agents: Array.isArray(r.agents)
      ? r.agents.map((a) => ({
          id: typeof a?.id === 'string' ? a.id : 'agent',
          name: typeof a?.name === 'string' ? a.name : 'Agent',
          role: typeof a?.role === 'string' ? a.role : '',
          status: typeof a?.status === 'string' ? a.status : 'unknown',
          subtask: typeof a?.subtask === 'string' ? a.subtask : '',
          doneSummary: typeof a?.doneSummary === 'string' ? a.doneSummary : undefined,
        }))
      : [],
    doneCount: typeof r.doneCount === 'number' ? r.doneCount : 0,
    totalCount: typeof r.totalCount === 'number' ? r.totalCount : 0,
    messageCount: typeof r.messageCount === 'number' ? r.messageCount : undefined,
    merge: merge
      ? {
          merged: Array.isArray(merge.merged) ? merge.merged.filter((m): m is string => typeof m === 'string') : [],
          promoted: Boolean(merge.promoted),
          conflicts: typeof merge.conflicts === 'number' ? merge.conflicts : 0,
          stagingBranch: typeof merge.stagingBranch === 'string' ? merge.stagingBranch : undefined,
        }
      : undefined,
  };
}

/** Past-collaborations list, read from the run archive (~/.moxxy/collab/runs). */
function CollabHistory({ runs, onClose }: { readonly runs: CollabRunSummary[] | null; readonly onClose: () => void }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  if (runs === null) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--color-text-dim)' }}>Loading history…</div>;
  }
  if (runs.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--color-text-dim)' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>No past collaborations yet</div>
        <button type="button" className="btn-ghost" onClick={onClose} style={{ fontSize: 12.5 }}>← Back</button>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {runs.map((r) => {
        const isOpen = open === r.runId;
        return (
          <div key={r.runId} style={{ border: '1px solid var(--color-card-border)', borderRadius: 10, background: 'var(--color-card-bg)' }}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : r.runId)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <span style={outcomeChip(r.outcome)}>{r.outcome}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-dim)', flexShrink: 0 }}>
                {r.doneCount}/{r.totalCount} · {whenAgo(r.startedAtMs)}
              </span>
            </button>
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--color-card-border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
                  {r.parallel ? 'parallel' : 'sequential'}
                  {r.merge ? ` · merged ${r.merge.merged.length}${r.merge.promoted ? ' (promoted)' : ''}${r.merge.conflicts ? ` · ${r.merge.conflicts} conflicts` : ''}` : ''}
                  {typeof r.messageCount === 'number' ? ` · ${r.messageCount} messages` : ''}
                </div>
                {r.agents.map((a) => (
                  <div key={a.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    <span className="mono" style={{ color: 'var(--color-text-dim)' }}> · {a.role} · {a.status}</span>
                    {a.doneSummary ? <div style={{ color: 'var(--color-text-muted)' }}>{a.doneSummary}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A short colour + label for a message's "kind", derived from its subject. */
function msgKind(subject?: string): { label: string; color: string } | null {
  if (!subject) return null;
  const s = subject.toLowerCase();
  if (s === 'directive') return { label: 'directive', color: 'var(--color-accent-strong)' };
  if (s.startsWith('done') || s.includes('complete')) return { label: 'done', color: 'var(--color-green)' };
  if (s.includes('block')) return { label: 'blocked', color: 'var(--color-amber-text)' };
  if (s.includes('progress') || s.includes('claim') || s.includes('start')) return { label: 'progress', color: 'var(--color-primary)' };
  if (s.includes('kickoff') || s.includes('ready')) return { label: 'kickoff', color: 'var(--color-primary-strong)' };
  return { label: subject.slice(0, 24), color: 'var(--color-text-dim)' };
}

function whenShort(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/** One message rendered as a chat card: author chip (human vs agent), a kind
 *  chip from the subject, a broadcast/DM tag, a timestamp, and the body. */
function MessageCard({ m }: { readonly m: CollabMsgView }): JSX.Element {
  const isHuman = m.from === 'human';
  const kind = msgKind(m.subject);
  return (
    <div
      style={{
        border: '1px solid var(--color-card-border)',
        borderRadius: 10,
        padding: '8px 11px',
        background: isHuman ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-card-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontWeight: 700, fontSize: 12, color: isHuman ? 'var(--color-accent-strong)' : 'var(--color-primary-strong)' }}>
          {m.from}
        </span>
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--color-text-dim)', border: '1px solid var(--color-card-border)', borderRadius: 'var(--radius-pill)', padding: '0 6px' }}
          title={m.to === 'all' ? 'broadcast to the whole team' : `direct message to ${m.to}`}
          aria-label={m.to === 'all' ? 'broadcast to the whole team' : `direct message to ${m.to}`}
        >
          <span aria-hidden>{m.to === 'all' ? '📣 all' : `→ ${m.to}`}</span>
        </span>
        {kind && (
          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: '#fff', background: kind.color, borderRadius: 'var(--radius-pill)', padding: '1px 6px' }}>
            {kind.label}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{whenShort(m.atMs)}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>{m.body}</div>
    </div>
  );
}

/** Modal with a task-board item's full detail: status, owner, deliverable files. */
function TaskModal({ task, onClose }: { readonly task?: CollabTaskView; readonly onClose: () => void }): JSX.Element | null {
  const titleId = useId();
  // Reuse the chat surface's dialog plumbing (focus move-in + Tab trap + Escape
  // + focus restoration) rather than re-implementing it — same contract AskSheet
  // and GoalModal use. `onEscape` is a STABLE callback (identity fixed for the
  // modal's life) reading the latest onClose via a ref, so useFocusTrap's effect
  // binds once on mount and doesn't re-run / re-focus on every parent re-render.
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onEscape = useRef(() => onCloseRef.current()).current;
  useFocusTrap({ containerRef: dialogRef, onEscape });
  if (!task) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 90%)', maxHeight: '80%', overflowY: 'auto', background: 'var(--color-app-bg)', border: '1px solid var(--color-card-border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={taskChip(task.status)}>{task.status}</span>
          <span id={titleId} style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{task.title}</span>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 16, lineHeight: 1, padding: '0 6px' }} aria-label="Close">×</button>
        </div>
        {task.owner && (
          <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>owner · @{task.owner}</div>
        )}
        {task.detail && (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text)' }}>{task.detail}</div>
        )}
        {task.paths && task.paths.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-dim)' }}>Deliverables</div>
            {task.paths.map((p) => (
              <div key={p} className="mono" style={{ fontSize: 12, color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>{p}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
