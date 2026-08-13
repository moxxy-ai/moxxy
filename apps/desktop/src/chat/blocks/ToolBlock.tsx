import { useState } from 'react';
import { isFileDiffResult, type ToolCallBlockData } from '@moxxy/chat-model';
import { isFileDiffDisplay, type FileDiffDisplay } from '@moxxy/sdk/tool-display';
import { ActivityRow } from '../ActivityRow';
import { iconForTool, statusOf, toolActivityLabel } from '../SkillGroupView';
import { useToolIcon } from '../ToolIconContext';
import { preStyle, pretty } from './block-shared';
import { FileDiffBlock } from './FileDiffBlock';

export function ToolBlock({ name, input, outcome }: {
  readonly name: string;
  readonly input: unknown;
  readonly outcome: ToolCallBlockData['outcome'];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const declared = useToolIcon(name);
  if (isFileDiffResult(outcome)) {
    const display = (outcome.output as { display: FileDiffDisplay }).display;
    if (isFileDiffDisplay(display)) return <FileDiffBlock display={display} />;
  }
  const status = statusOf(outcome);
  const output = outcome?.type === 'tool_result' ? outcome.output : undefined;
  const error = outcome === null ? undefined : outcome.type === 'denied' ? outcome.reason : outcome.error?.message;
  return (
    <div className="activity-block" data-testid="block-tool" data-status={status}>
      <ActivityRow
        icon={iconForTool(name, declared)}
        label={toolActivityLabel({ name, input, outcome })}
        meta={status === 'error' ? 'failed' : undefined}
        active={status === 'running'}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className="activity-detail-row__body activity-detail-row__body--root">
          <pre style={preStyle}>{pretty(input)}</pre>
          {output !== undefined ? <pre style={preStyle}>{pretty(output)}</pre> : null}
          {error ? <pre style={{ ...preStyle, color: 'var(--color-red)' }}>{error}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
