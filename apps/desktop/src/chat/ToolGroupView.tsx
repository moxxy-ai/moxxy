import {
  buildCompactSummary,
  compactPreviewLine,
  type LiveToolBlockData,
  type ToolCallBlockData,
} from '@moxxy/chat-model';
import { ActivityRow } from './ActivityRow';
import { iconForTool, statusOf, ToolRow, useActivityDisclosure, type ToolRowData, ActivityCount, stepLabel, stepDuration, ToolRows } from './SkillGroupView';
import { useToolIcon } from './ToolIconContext';

function errorCount(rows: ReadonlyArray<ToolRowData>): number {
  return rows.filter((row) => statusOf(row.outcome) === 'error').length;
}

export function ToolGroupView({
  tools,
  step,
}: {
  readonly tools: ReadonlyArray<ToolCallBlockData>;
  readonly step?: number;
}): JSX.Element {
  const rows: ToolRowData[] = tools.map((tool) => ({
    id: tool.id,
    name: tool.request.name,
    input: tool.request.input,
    outcome: tool.outcome,
    requestedAt: tool.request.ts,
  }));
  const running = rows.some((row) => statusOf(row.outcome) === 'running');
  const [open, toggle] = useActivityDisclosure(running);
  const errors = errorCount(rows);
  return (
    <div
      className="activity-block"
      data-testid="block-tool-group"
      data-status={errors > 0 ? 'error' : running ? 'running' : 'ok'}
    >
      <ActivityRow
        icon="wrench"
        label={stepLabel(step, `${running ? 'Running' : 'Ran'} ${rows.length} tools${running ? '…' : ''}`)}
        meta={
          <>
            <ActivityCount total={rows.length} failed={errors} />
            {stepDuration(rows) !== null && (
              <span className="activity-row__dur">{stepDuration(rows)}</span>
            )}
          </>
        }
        active={running}
        open={open}
        onToggle={toggle}
      />
      {rows.length > 0 && <ToolRows rows={rows} open={open} onExpand={toggle} />}
    </div>
  );
}

export function LiveToolGroupView({
  block,
  step,
}: {
  readonly block: LiveToolBlockData;
  readonly step?: number;
}): JSX.Element {
  const rows: ToolRowData[] = block.calls.map((call) => ({
    id: call.id,
    name: call.request.name,
    input: call.request.input,
    outcome: call.outcome,
          requestedAt: call.request.ts,
  }));
  const running = !block.closed || rows.some((row) => statusOf(row.outcome) === 'running');
  const [open, toggle] = useActivityDisclosure(running);
  const errors = errorCount(rows);
  const latest = block.calls.at(-1);
  const latestIcon = useToolIcon(latest?.request.name ?? '');
  return (
    <div
      className="activity-block"
      data-testid="block-live-tools"
      data-status={errors > 0 ? 'error' : running ? 'running' : 'ok'}
    >
      <ActivityRow
        icon={latest ? iconForTool(latest.request.name, latestIcon) : 'wrench'}
        label={stepLabel(step, buildCompactSummary(block.calls, running))}
        meta={
          <>
            <ActivityCount total={rows.length} failed={errors} />
            {stepDuration(rows) !== null && (
              <span className="activity-row__dur">{stepDuration(rows)}</span>
            )}
          </>
        }
        active={running}
        open={open}
        onToggle={toggle}
      />
      {rows.length > 0 ? (
        <ToolRows rows={rows} open={open} onExpand={toggle} />
      ) : latest ? (
        <div className="activity-preview">{compactPreviewLine(latest)}</div>
      ) : null}
    </div>
  );
}
