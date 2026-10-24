import type { ReactNode } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { showInChat, useAgentWork } from '@moxxy/client-core';
import type { AgentWorkItem } from '@moxxy/chat-model';
import { STATUS_TEXT, toolLine, wakeupMeta, workMeta } from './agent-work-view';
import { MarkdownBody } from '../../../chat/MarkdownBody';
import { useNow } from './useNow';
import './agents.css';

/**
 * The agent's helpers, background commands and scheduled wakeups of one chat. The list shows
 * what runs now first; picking one opens its mini chat (a helper: its task,
 * what it said and did, its answer) or its output (a command), with Stop
 * while it runs. Nothing here writes to the agent.
 */
export function AgentsPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const work = useAgentWork(workspaceId);
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
  return (
    <section className="agents-pane" aria-label="Background work">
      <header className="agents-pane__header">
        <span>Background work</span>
        {work.running > 0 && <span className="agents-pane__count">{work.running} running</span>}
      </header>
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
          {running.length > 0 && <WorkList title="Running" items={running} now={now} onPick={work.select} />}
          {ended.length > 0 && <WorkList title="Earlier" items={ended} now={now} onPick={work.select} />}
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

function WorkList({
  title,
  items,
  now,
  onPick,
}: {
  readonly title: string;
  readonly items: ReadonlyArray<AgentWorkItem>;
  readonly now: number;
  readonly onPick: (id: string) => void;
}): JSX.Element {
  return (
    <WorkGroup title={title}>
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="agent-work" data-status={item.status} onClick={() => onPick(item.id)}>
            <span className="agent-work__tile" aria-hidden>
              <Icon name={item.kind === 'command' ? 'terminal' : 'agent'} size={15} />
            </span>
            <span className="agent-work__text">
              <span className="agent-work__label">{item.label}</span>
              <span className="agent-work__meta">{workMeta(item, now)}</span>
            </span>
            <span className="agent-work__status">{STATUS_TEXT[item.status]}</span>
          </button>
        </li>
      ))}
    </WorkGroup>
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
