import {
  buildCompactSummary,
  type LiveToolBlockData,
  type ToolCallBlockData,
} from '@moxxy/chat-model';
import { currentToolActivity } from './current-tool-activity';
import { ActivityRow } from './ActivityRow';
import { iconForTool, statusOf, useActivityDisclosure, type ToolRowData, ActivityCount, stepDuration, ToolRows } from './SkillGroupView';
import { useToolIcon } from './ToolIconContext';

function errorCount(rows: ReadonlyArray<ToolRowData>): number {
  return rows.filter((row) => statusOf(row.outcome) === 'error').length;
}

export function ToolGroupView({
  tools,
}: {
  readonly tools: ReadonlyArray<ToolCallBlockData>;
}): JSX.Element {
  const rows: ToolRowData[] = tools.map((tool) => ({
    id: tool.id,
    name: tool.request.name,
    input: tool.request.input,
    outcome: tool.outcome,
    requestedAt: tool.request.ts,
  }));
  const current = rows.findLast((row) => row.outcome === null);
  const running = current !== undefined;
  const [open, toggle] = useActivityDisclosure();
  const errors = errorCount(rows);
  return (
    <div
      className="activity-block"
      data-testid="block-tool-group"
      data-status={errors > 0 ? 'error' : running ? 'running' : 'ok'}
    >
      <ActivityRow
        icon="wrench"
        label={current ? currentToolActivity(current.name, current.input) : `Ran ${rows.length} tools`}
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
      {open && rows.length > 0 && <ToolRows rows={rows} open onExpand={toggle} />}
    </div>
  );
}

export function LiveToolGroupView({
  block,
}: {
  readonly block: LiveToolBlockData;
}): JSX.Element {
  const rows: ToolRowData[] = block.calls.map((call) => ({
    id: call.id,
    name: call.request.name,
    input: call.request.input,
    outcome: call.outcome,
    requestedAt: call.request.ts,
  }));
  const current = rows.findLast((row) => row.outcome === null);
  const running = current !== undefined;
  const [open, toggle] = useActivityDisclosure();
  const errors = errorCount(rows);
  const completed = block.calls.filter((call) => statusOf(call.outcome) === 'ok');
  const summary = completed.length ? buildCompactSummary(completed, false) : 'No steps completed';
  const latest = current ?? rows.at(-1);
  const latestIcon = useToolIcon(latest?.name ?? '');
  return (
    <div
      className="activity-block"
      data-testid="block-live-tools"
      data-status={errors > 0 ? 'error' : running ? 'running' : 'ok'}
    >
      <ActivityRow
        icon={latest ? iconForTool(latest.name, latestIcon) : 'wrench'}
        label={current ? currentToolActivity(current.name, current.input) : summary}
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
      {open && rows.length > 0 && <ToolRows rows={rows} open onExpand={toggle} />}
    </div>
  );
}
