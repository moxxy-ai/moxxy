import { useState } from 'react';
import {
  describeToolCall,
  isFileDiffResult,
  formatToolActivity,
  type Block as FoldedBlock,
  type ToolCallBlockData,
} from '@moxxy/chat-model';
import { isFileDiffDisplay, type FileDiffDisplay } from '@moxxy/sdk/tool-display';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import type { ToolIcon } from '@moxxy/sdk';
import { useToolIcon } from './ToolIconContext';
import { ActivityRow } from './ActivityRow';
import { FileDiffBlock } from './blocks/FileDiffBlock';
import { preStyle, pretty } from './blocks/block-shared';

type SkillScope = Extract<FoldedBlock, { kind: 'skill-scope' }>;

export interface ToolRowData {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly outcome: ToolCallBlockData['outcome'];
  /** `ts` of the request event, so a row can report its own MEASURED duration
   *  rather than a guess. */
  readonly requestedAt: number;
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
        requestedAt: child.request.ts,
      });
    } else if (child.kind === 'live-tools') {
      for (const call of child.calls) {
        out.push({
          id: call.id,
          name: call.request.name,
          input: call.request.input,
          outcome: call.outcome,
          requestedAt: call.request.ts,
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

/**
 * Every `ToolIcon` the SDK defines, mapped to this surface's artwork.
 *
 * Typed as a total Record so adding a member to `TOOL_ICONS` fails to compile
 * here rather than silently rendering a wrench. That is the point of the closed
 * vocabulary: a new icon is a decision made across surfaces, not a fallback.
 */
const TOOL_ICON_ART: Record<ToolIcon, IconName> = {
  file: 'file',
  folder: 'folder',
  search: 'search',
  edit: 'edit',
  diff: 'diff',
  terminal: 'terminal',
  globe: 'globe',
  chat: 'chat',
  workflow: 'workflow',
  agent: 'agent',
  settings: 'settings',
  lock: 'lock',
  plug: 'plug',
  mic: 'mic',
  speaker: 'speaker',
  smartphone: 'smartphone',
  workspace: 'workspace',
  clipboard: 'copy',
  spark: 'spark',
  wrench: 'wrench',
};

/**
 * A declared icon wins; the name heuristic is only a fallback.
 *
 * The heuristic alone could only ever recognise the handful of built-ins it was
 * written against, so every plugin-contributed tool drew the same wrench with
 * no way for its author to say otherwise.
 */
export function iconForTool(name: string, declared?: ToolIcon): IconName {
  if (declared && declared in TOOL_ICON_ART) return TOOL_ICON_ART[declared];
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
export function useActivityDisclosure(): readonly [boolean, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen((value) => !value)];
}

/** Elapsed time for one call, from the request's timestamp to its result's. Both
 *  events carry `ts`, so this is measured, not estimated; null while a call is
 *  still in flight or was denied without a result. */
export function callDuration(tool: ToolRowData): string | null {
  const outcome = tool.outcome;
  if (outcome === null || outcome.type === 'denied') return null;
  const ms = outcome.ts - tool.requestedAt;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** Wall time for a whole step: the first request to the last result. */
export function stepDuration(tools: ReadonlyArray<ToolRowData>): string | null {
  const starts = tools.map((t) => t.requestedAt).filter((n) => Number.isFinite(n));
  const ends = tools
    .map((t) => (t.outcome !== null && t.outcome.type !== 'denied' ? t.outcome.ts : NaN))
    .filter((n) => Number.isFinite(n));
  if (starts.length === 0 || ends.length === 0) return null;
  const ms = Math.max(...ends) - Math.min(...starts);
  if (ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/**
 * The right-hand reading on a group header: how many calls it made, and how many
 * of them failed. A bare number said nothing about what was being counted, and
 * the failure count used to take its place rather than sit beside it.
 */
export function ActivityCount({
  total,
  failed,
}: {
  readonly total: number;
  readonly failed: number;
}): JSX.Element | null {
  if (total === 0 && failed === 0) return null;
  return (
    <>
      {failed > 0 && (
        <span className="activity-row__fail" data-testid="activity-failed">
          {failed} failed
        </span>
      )}
      {total > 0 && <span>{total === 1 ? '1 call' : `${total} calls`}</span>}
    </>
  );
}

export function SkillGroupView({ scope }: { readonly scope: SkillScope }): JSX.Element {
  const tools = collectTools(scope.children);
  const runningTools = tools.some((tool) => statusOf(tool.outcome) === 'running');
  const running = scope.loading || runningTools;
  const [open, toggle] = useActivityDisclosure();
  const errors = tools.filter((tool) => statusOf(tool.outcome) === 'error').length;
  // The scope's own status, so a failed skill is MARKED rather than looking
  // exactly like one that succeeded. Nothing set this before, which is why a
  // failure was invisible until you expanded the group.
  const status = errors > 0 ? 'error' : running ? 'running' : 'ok';
  // The failure count never REPLACES the total. It used to: a scope with two
  // failures out of sixteen calls read as "2 failed" and lost all sense of how
  // much work had happened. Both facts, failures first, because that is the one
  // you would act on.
  const meta = (
    <>
      <ActivityCount total={tools.length} failed={errors} />
      {stepDuration(tools) !== null && (
        <span className="activity-row__dur">{stepDuration(tools)}</span>
      )}
    </>
  );
  const label = scope.loading
    ? `Loading skill ${scope.skillEvent.name}…`
    : scope.closed
      ? `Used skill ${scope.skillEvent.name}`
      : tools.length > 0
        ? `Using skill ${scope.skillEvent.name}`
        : `Loaded skill ${scope.skillEvent.name}`;

  return (
    <div className="activity-block" data-testid="block-skill" data-status={status}>
      <ActivityRow
        label={label}
        meta={meta}
        active={running}
        open={open}
        onToggle={toggle}
      />
      {open && tools.length > 0 && <ToolRows rows={tools} open onExpand={toggle} />}
    </div>
  );
}

/** Rows a step shows before it folds. Four is about where a list stops being
 *  readable at a glance and starts being something you scroll past. */
export const STEP_PREVIEW_ROWS = 4;

/**
 * A step's rows: the first few ALWAYS visible, the rest behind one fold line.
 *
 * The group used to be all-or-nothing — collapsed to a single summary once it
 * finished, so a step's work was invisible until you clicked, or fully expanded,
 * so sixteen `web_fetch` rows pushed the agent's actual answer off the screen.
 * Showing the opening of the step and naming what is hidden gives you the shape
 * of the work without the wall of it.
 */
export function ToolRows({
  rows,
  open,
  onExpand,
}: {
  readonly rows: ReadonlyArray<ToolRowData>;
  readonly open: boolean;
  readonly onExpand: () => void;
}): JSX.Element {
  const hidden = open ? 0 : Math.max(0, rows.length - STEP_PREVIEW_ROWS);
  const shown = open ? rows : rows.slice(0, STEP_PREVIEW_ROWS);
  return (
    <>
      <ul className="activity-list" role="list">
        {shown.map((row) => (
          <ToolRow key={row.id} tool={row} />
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="activity-fold" onClick={onExpand}>
          <b>
            {hidden} more {hidden === 1 ? 'call' : 'calls'}
          </b>
          {/* Names what is behind the fold, so it is a summary rather than a
              door: "2 more calls" alone tells you nothing about whether to open
              it. */}
          <span>{foldPreview(rows.slice(STEP_PREVIEW_ROWS))}</span>
        </button>
      )}
    </>
  );
}

/** The tail of what a fold hides: distinct tool names, in order, truncated. */
function foldPreview(hidden: ReadonlyArray<ToolRowData>): string {
  const names: string[] = [];
  for (const row of hidden) {
    if (!names.includes(row.name)) names.push(row.name);
    if (names.length === 3) break;
  }
  return names.join(', ');
}

export function ToolRow({ tool }: { readonly tool: ToolRowData }): JSX.Element {
  const [open, setOpen] = useState(false);
  const call = describeToolCall(tool.name, tool.input);
  const duration = callDuration(tool);
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
      {/* Two columns: the tool's own name, then what it was called on. The row
          used to be an icon plus one sentence with the verb baked in ("Ran
          workflow_create · intent=…"), so every row in a group of sixteen opened
          with the same word and the name it was introducing sat mid-string where
          nothing could align or weight it. */}
      <button type="button" className="activity-detail-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={`activity-detail-row__name${status === 'running' ? ' activity-shimmer' : ''}`}>
          {call.name}
        </span>
        <span className="activity-detail-row__label">{call.detail}</span>
        {status === 'error' ? <span className="activity-detail-row__error">failed</span> : null}
        {duration !== null && <span className="activity-detail-row__dur">{duration}</span>}
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
