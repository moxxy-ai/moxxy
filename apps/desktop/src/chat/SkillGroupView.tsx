import { useEffect, useRef, useState } from 'react';
import {
  isFileDiffResult,
  formatToolActivity,
  type Block as FoldedBlock,
  type ToolCallBlockData,
} from '@moxxy/chat-model';
import { isFileDiffDisplay, type FileDiffDisplay } from '@moxxy/sdk/tool-display';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import { ActivityRow } from './ActivityRow';
import { FileDiffBlock } from './blocks/FileDiffBlock';
import { preStyle, pretty } from './blocks/block-shared';

type SkillScope = Extract<FoldedBlock, { kind: 'skill-scope' }>;

export interface ToolRowData {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly outcome: ToolCallBlockData['outcome'];
}

function collectTools(children: ReadonlyArray<FoldedBlock>): ToolRowData[] {
  const out: ToolRowData[] = [];
  for (const child of children) {
    if (child.kind === 'tool-call') {
      out.push({
        id: child.id,
        name: child.request.name,
        input: child.request.input,
        outcome: child.outcome,
      });
    } else if (child.kind === 'live-tools') {
      for (const call of child.calls) {
        out.push({
          id: call.id,
          name: call.request.name,
          input: call.request.input,
          outcome: call.outcome,
        });
      }
    }
  }
  return out;
}

export function statusOf(outcome: ToolCallBlockData['outcome']): 'running' | 'ok' | 'error' {
  if (outcome === null) return 'running';
  if (outcome.type === 'denied') return 'error';
  return outcome.ok ? 'ok' : 'error';
}

export function iconForTool(name: string): IconName {
  const normalized = name.toLowerCase();
  if (normalized === 'read') return 'file';
  if (normalized === 'grep' || normalized.includes('search')) return 'search';
  if (normalized === 'glob') return 'folder';
  if (normalized === 'bash' || normalized === 'exec' || normalized.includes('command')) return 'terminal';
  return 'wrench';
}

/** Human-readable line matching the activity-list treatment in the reference. */
export function toolActivityLabel(tool: Pick<ToolRowData, 'name' | 'input' | 'outcome'>): string {
  return formatToolActivity(tool.name, tool.input, statusOf(tool.outcome) === 'running');
}

/** Starts expanded while work is live, then quietly collapses when it settles
 * unless the user has explicitly chosen a state. */
export function useActivityDisclosure(running: boolean): readonly [boolean, () => void] {
  const [open, setOpen] = useState(running);
  const touched = useRef(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (!touched.current) {
      if (wasRunning.current && !running) setOpen(false);
      if (!wasRunning.current && running) setOpen(true);
    }
    wasRunning.current = running;
  }, [running]);
  return [
    open,
    () => {
      touched.current = true;
      setOpen((value) => !value);
    },
  ];
}

export function SkillGroupView({ scope }: { readonly scope: SkillScope }): JSX.Element {
  const tools = collectTools(scope.children);
  const runningTools = tools.some((tool) => statusOf(tool.outcome) === 'running');
  const running = scope.loading || runningTools;
  const [open, toggle] = useActivityDisclosure(running);
  const errors = tools.filter((tool) => statusOf(tool.outcome) === 'error').length;
  const meta = errors > 0 ? `${errors} failed` : tools.length > 0 ? `${tools.length}` : undefined;
  const label = scope.loading
    ? `Loading skill ${scope.skillEvent.name}…`
    : scope.closed
      ? `Used skill ${scope.skillEvent.name}`
      : tools.length > 0
        ? `Using skill ${scope.skillEvent.name}`
        : `Loaded skill ${scope.skillEvent.name}`;

  return (
    <div className="activity-block" data-testid="block-skill">
      <ActivityRow
        icon="spark"
        label={label}
        meta={meta}
        active={running}
        open={open}
        onToggle={toggle}
      />
      {open ? (
        <ul className="activity-list" role="list">
          {tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}
        </ul>
      ) : null}
    </div>
  );
}

export function ToolRow({ tool }: { readonly tool: ToolRowData }): JSX.Element {
  const [open, setOpen] = useState(false);
  if (isFileDiffResult(tool.outcome)) {
    const display = (tool.outcome.output as { display: FileDiffDisplay }).display;
    if (isFileDiffDisplay(display)) {
      return <li className="activity-list__diff"><FileDiffBlock display={display} /></li>;
    }
  }

  const status = statusOf(tool.outcome);
  const output = tool.outcome?.type === 'tool_result' ? tool.outcome.output : undefined;
  const error = tool.outcome === null
    ? undefined
    : tool.outcome.type === 'denied'
      ? tool.outcome.reason
      : tool.outcome.error?.message;
  return (
    <li className="activity-list__item" data-status={status}>
      <button type="button" className="activity-detail-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="activity-detail-row__icon" aria-hidden><Icon name={iconForTool(tool.name)} size={16} /></span>
        <span className={`activity-detail-row__label${status === 'running' ? ' activity-shimmer' : ''}`}>{toolActivityLabel(tool)}</span>
        {status === 'error' ? <span className="activity-detail-row__error">failed</span> : null}
      </button>
      {open ? (
        <div className="activity-detail-row__body">
          <pre style={preStyle}>{pretty(tool.input)}</pre>
          {output !== undefined ? <pre style={preStyle}>{pretty(output)}</pre> : null}
          {error ? <pre style={{ ...preStyle, color: 'var(--color-red)' }}>{error}</pre> : null}
        </div>
      ) : null}
    </li>
  );
}
