import {
  buildCompactSummary,
  compactPreviewLine,
  type LiveToolBlockData,
  type ToolCallBlockData,
} from '@moxxy/chat-model';
import { ActivityRow } from './ActivityRow';
import { iconForTool, statusOf, ToolRow, useActivityDisclosure, type ToolRowData } from './SkillGroupView';
import { useToolIcon } from './ToolIconContext';

function errorCount(rows: ReadonlyArray<ToolRowData>): number {
  return rows.filter((row) => statusOf(row.outcome) === 'error').length;
}

function ActivityToolList({ rows }: { readonly rows: ReadonlyArray<ToolRowData> }): JSX.Element {
  return <ul className="activity-list" role="list">{rows.map((row) => <ToolRow key={row.id} tool={row} />)}</ul>;
}

export function ToolGroupView({ tools }: { readonly tools: ReadonlyArray<ToolCallBlockData> }): JSX.Element {
  const rows: ToolRowData[] = tools.map((tool) => ({
    id: tool.id,
    name: tool.request.name,
    input: tool.request.input,
    outcome: tool.outcome,
  }));
  const running = rows.some((row) => statusOf(row.outcome) === 'running');
  const [open, toggle] = useActivityDisclosure(running);
  const errors = errorCount(rows);
  return (
    <div className="activity-block" data-testid="block-tool-group">
      <ActivityRow
        icon="wrench"
        label={`${running ? 'Running' : 'Ran'} ${rows.length} tools${running ? '…' : ''}`}
        meta={errors > 0 ? `${errors} failed` : undefined}
        active={running}
        open={open}
        onToggle={toggle}
      />
      {open ? <ActivityToolList rows={rows} /> : null}
    </div>
  );
}

export function LiveToolGroupView({ block }: { readonly block: LiveToolBlockData }): JSX.Element {
  const rows: ToolRowData[] = block.calls.map((call) => ({
    id: call.id,
    name: call.request.name,
    input: call.request.input,
    outcome: call.outcome,
  }));
  const running = !block.closed || rows.some((row) => statusOf(row.outcome) === 'running');
  const [open, toggle] = useActivityDisclosure(running);
  const errors = errorCount(rows);
  const latest = block.calls.at(-1);
  const latestIcon = useToolIcon(latest?.request.name ?? '');
  return (
    <div className="activity-block" data-testid="block-live-tools">
      <ActivityRow
        icon={latest ? iconForTool(latest.request.name, latestIcon) : 'wrench'}
        label={buildCompactSummary(block.calls, running)}
        meta={errors > 0 ? `${errors} failed` : undefined}
        active={running}
        open={open}
        onToggle={toggle}
      />
      {open ? <ActivityToolList rows={rows} /> : latest ? <div className="activity-preview">{compactPreviewLine(latest)}</div> : null}
    </div>
  );
}
