import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { showInChat } from '@moxxy/client-core';
import type { AgentWorkItem, AgentWorkStatus } from '@moxxy/chat-model';
import { STATUS_TEXT, toolLine, wakeupMeta, workKind, workMeta } from './agent-work-view';
import { MarkdownBody } from '../../../chat/MarkdownBody';
import { PopoverMenu, type MenuEntry } from '../../menu/PopoverMenu';
import { usePopover } from '../../menu/usePopover';
import { useAgentsPane, type UseAgentsPane, type WorkScope } from './useAgentsPane';
import { projectWorkKey } from './useProjectWork';
import { useNow } from './useNow';
import './agents.css';

/**
 * The agent's helpers, background commands and scheduled wakeups of one chat. The list shows
 * what runs now first; picking one opens its mini chat (a helper: its task,
 * what it said and did, its answer) or its output (a command), with Stop
 * while it runs. Each row has a menu (also on a right click) to stop it or
 * copy its command. "Whole project" lists what runs now in every chat of the
 * project instead. Nothing here writes to the agent.
 */
export function AgentsPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const pane = useAgentsPane(workspaceId);
  const { work } = pane;
  // A countdown to a wakeup reads in minutes, so it ticks with the durations of what runs.
  const now = useNow(work.running > 0 || work.scheduled.length > 0);
  const running = work.items.filter((item) => item.status === 'running');
  const ended = work.items.filter((item) => item.status !== 'running');
  if (work.selected) {
    return (
      <WorkDetail
        item={work.selected}
        now={now}
        stopping={work.stopping.has(work.selected.id)}
        onBack={() => work.select(null)}
        onStop={(id) => void work.stop(id)}
        onShowInChat={workspaceId ? (eventId) => showInChat(workspaceId, eventId) : null}
      />
    );
  }
  const empty = work.items.length === 0 && work.scheduled.length === 0;
  const header = (
    <header className="agents-pane__header">
      <span>Background work</span>
      {pane.scope === 'chat' && work.running > 0 && <span className="agents-pane__count">{work.running} running</span>}
      <ScopeToggle scope={pane.scope} onScope={pane.setScope} />
    </header>
  );
  if (pane.scope === 'project') {
    return (
      <section className="agents-pane" aria-label="Background work">
        {header}
        <ProjectList pane={pane} />
      </section>
    );
  }
  const menuOf = (item: AgentWorkItem) => (): ReadonlyArray<MenuEntry> =>
    workMenu(pane, {
      chat: workspaceId,
      label: item.label,
      running: item.status === 'running',
      stopping: work.stopping.has(item.id),
      onStop: () => void work.stop(item.id),
    });
  return (
    <section className="agents-pane" aria-label="Background work">
      {header}
      {empty ? (
        <div className="agents-pane__empty">
          <span className="agents-pane__empty-icon" aria-hidden>
            <Icon name="agent" size={20} />
          </span>
          <h3>No background work in this chat yet</h3>
          <p>Helpers the agent starts, commands it leaves running and times it sets to come back show here.</p>
        </div>
      ) : (
        <div className="agents-pane__body">
          {work.scheduled.length > 0 && (
            <WorkGroup title="Scheduled">
              {work.scheduled.map((wakeup) => (
                <li key={wakeup.id}>
                  <div className="agent-work" data-status="scheduled">
                    <span className="agent-work__tile" aria-hidden>
                      <Icon name="clock" size={15} />
                    </span>
                    <span className="agent-work__text">
                      <span className="agent-work__label" data-tip={wakeup.prompt}>
                        {wakeup.prompt}
                      </span>
                      <span className="agent-work__meta">{wakeupMeta(wakeup, now)}</span>
                    </span>
                  </div>
                </li>
              ))}
            </WorkGroup>
          )}
          {running.length > 0 && <WorkList title="Running" items={running} now={now} onPick={work.select} menuOf={menuOf} />}
          {ended.length > 0 && <WorkList title="Earlier" items={ended} now={now} onPick={work.select} menuOf={menuOf} />}
        </div>
      )}
    </section>
  );
}

function WorkGroup({ title, children }: { readonly title: string; readonly children: ReactNode }): JSX.Element {
  const id = `agents-group-${title.toLowerCase()}`;
  return (
    <div className="agents-pane__group" role="group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul role="list">{children}</ul>
    </div>
  );
}

function ScopeToggle({ scope, onScope }: { readonly scope: WorkScope; readonly onScope: (scope: WorkScope) => void }): JSX.Element {
  return (
    <span className="agents-pane__scope" role="group" aria-label="Show work of">
      <button type="button" aria-pressed={scope === 'chat'} onClick={() => onScope('chat')}>
        This chat
      </button>
      <button type="button" aria-pressed={scope === 'project'} onClick={() => onScope('project')}>
        Whole project
      </button>
    </span>
  );
}

/** What a work's menu offers: Stop while it runs, and its command to copy (its name when the command is not known). */
function workMenu(
  pane: UseAgentsPane,
  work: {
    readonly chat: string | null;
    readonly label: string;
    readonly running: boolean;
    readonly stopping: boolean;
    readonly onStop: () => void;
  },
): ReadonlyArray<MenuEntry> {
  const command = work.chat ? pane.commandOf(work.chat, work.label) : null;
  return [
    ...(work.running
      ? [{ id: 'stop', label: work.stopping ? 'Stopping…' : 'Stop', icon: 'stop' as const, disabled: work.stopping, danger: true, onSelect: work.onStop }]
      : []),
    command !== null
      ? { id: 'copy', label: 'Copy command', icon: 'copy' as const, onSelect: () => void pane.copy(command) }
      : { id: 'copy', label: 'Copy name', icon: 'copy' as const, onSelect: () => void pane.copy(work.label) },
  ];
}

function WorkList({
  title,
  items,
  now,
  onPick,
  menuOf,
}: {
  readonly title: string;
  readonly items: ReadonlyArray<AgentWorkItem>;
  readonly now: number;
  readonly onPick: (id: string) => void;
  readonly menuOf: (item: AgentWorkItem) => () => ReadonlyArray<MenuEntry>;
}): JSX.Element {
  return (
    <WorkGroup title={title}>
      {items.map((item) => (
        <WorkRow
          key={item.id}
          label={item.label}
          meta={workMeta(item, now)}
          kind={item.kind}
          status={item.status}
          onPick={() => onPick(item.id)}
          menu={menuOf(item)}
        />
      ))}
    </WorkGroup>
  );
}

/** What runs now in every chat of the project, each with the chat it runs in. */
function ProjectList({ pane }: { readonly pane: UseAgentsPane }): JSX.Element {
  const { project } = pane;
  if (project.items.length === 0) {
    return (
      <div className="agents-pane__empty">
        <span className="agents-pane__empty-icon" aria-hidden>
          <Icon name="agent" size={20} />
        </span>
        <h3>{project.loading ? 'Looking at the project’s chats…' : 'Nothing runs in the background in this project'}</h3>
        <p>Commands and helpers the agent leaves running in any chat of this project show here.</p>
      </div>
    );
  }
  return (
    <div className="agents-pane__body">
      <WorkGroup title="Running">
        {project.items.map((item) => {
          const key = projectWorkKey(item);
          return (
            <WorkRow
              key={key}
              label={item.work.label}
              meta={`${workKind(item.work.kind, null)} · ${item.chat}`}
              kind={item.work.kind}
              status="running"
              onPick={null}
              menu={() =>
                workMenu(pane, {
                  chat: item.workspaceId,
                  label: item.work.label,
                  running: true,
                  stopping: project.stopping.has(key),
                  onStop: () => void project.stop(item),
                })
              }
            />
          );
        })}
      </WorkGroup>
    </div>
  );
}

/** One work: picking it opens it (when it can be opened), its menu sits on the ⋯ button and on a right click. */
function WorkRow({
  label,
  meta,
  kind,
  status,
  onPick,
  menu,
}: {
  readonly label: string;
  readonly meta: string;
  readonly kind: AgentWorkItem['kind'];
  readonly status: AgentWorkStatus;
  readonly onPick: (() => void) | null;
  /** Read when the menu opens: finding a command reads the chat's log. */
  readonly menu: () => ReadonlyArray<MenuEntry>;
}): JSX.Element {
  const popover = usePopover<HTMLButtonElement, HTMLDivElement>({ side: 'bottom', align: 'end', width: 200 });
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (!popover.open) popover.toggle({ detail: 1 });
  };
  const body = (
    <>
      <span className="agent-work__tile" aria-hidden>
        <Icon name={kind === 'command' ? 'terminal' : 'agent'} size={15} />
      </span>
      <span className="agent-work__text">
        <span className="agent-work__label">{label}</span>
        <span className="agent-work__meta">{meta}</span>
      </span>
      <span className="agent-work__status">{STATUS_TEXT[status]}</span>
    </>
  );
  return (
    <li className="agent-work__row" onContextMenu={onContextMenu}>
      {onPick ? (
        <button type="button" className="agent-work" data-status={status} onClick={onPick}>
          {body}
        </button>
      ) : (
        <div className="agent-work" data-status={status}>
          {body}
        </div>
      )}
      <button
        ref={popover.anchorRef}
        type="button"
        className="btn-quiet agent-work__more"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={popover.toggle}
      >
        <Icon name="more" size={14} />
      </button>
      <PopoverMenu popover={popover} label={label} entries={popover.open ? menu() : []} />
    </li>
  );
}

function WorkDetail({
  item,
  now,
  stopping,
  onBack,
  onStop,
  onShowInChat,
}: {
  readonly item: AgentWorkItem;
  readonly now: number;
  readonly stopping: boolean;
  readonly onBack: () => void;
  readonly onStop: (id: string) => void;
  readonly onShowInChat: ((eventId: string) => void) | null;
}): JSX.Element {
  return (
    <section className="agents-pane" aria-label={item.label}>
      <header className="agents-pane__detail-head">
        <button type="button" className="btn-quiet" aria-label="All work" onClick={onBack}>
          <span className="agents-pane__back" aria-hidden>
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
        <span className="agent-work__text">
          <span className="agent-work__label">{item.label}</span>
          <span className="agent-work__meta">
            {workMeta(item, now)} · {stopping ? 'Stopping…' : STATUS_TEXT[item.status]}
          </span>
        </span>
        {item.status === 'running' && (
          <button type="button" className="agents-pane__stop" disabled={stopping} onClick={() => onStop(item.id)}>
            <Icon name="stop" size={12} />
            Stop
          </button>
        )}
      </header>
      <div className="agents-pane__body agent-chat">
        {item.kind === 'agent' ? <HelperChat item={item} /> : <CommandOutput item={item} />}
        {item.continuedBy && onShowInChat && (
          <button type="button" className="agents-pane__link" onClick={() => onShowInChat(item.continuedBy ?? '')}>
            Show in chat
          </button>
        )}
      </div>
    </section>
  );
}

function HelperChat({ item }: { readonly item: AgentWorkItem }): JSX.Element {
  return (
    <>
      {item.prompt && <p className="agent-chat__task">{item.prompt}</p>}
      {item.steps.map((step, i) =>
        step.kind === 'message' ? (
          <div key={i} className="agent-chat__said">
            <MarkdownBody text={step.text} streaming={false} />
          </div>
        ) : (
          <div key={i} className="agent-chat__tool">
            <span className="agent-chat__tool-name">{step.name}</span>
            <span className="agent-chat__tool-input">{toolLine(step.input)}</span>
          </div>
        ),
      )}
      {item.status === 'running' && <p className="agent-chat__working">Working…</p>}
      {item.answer && (
        <div className="agent-chat__answer">
          <MarkdownBody text={item.answer} streaming={false} />
        </div>
      )}
      {item.error && <p className="agent-chat__error">{item.error}</p>}
    </>
  );
}

function CommandOutput({ item }: { readonly item: AgentWorkItem }): JSX.Element {
  return (
    <>
      {item.summary && item.summary !== item.label && <p className="agent-chat__said">{item.summary}</p>}
      {item.output ? (
        <pre className="agent-chat__output">{item.output}</pre>
      ) : (
        <p className="agent-chat__working">{item.status === 'running' ? 'Running. Its output shows here once it ends.' : 'It printed nothing.'}</p>
      )}
    </>
  );
}
