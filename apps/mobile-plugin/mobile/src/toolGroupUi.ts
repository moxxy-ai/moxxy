import type { ToolTranscriptItem } from './chatTranscript';

export interface ToolGroupUi {
  readonly accent: string;
  readonly tint: string;
  readonly statusLabel: 'failed' | 'running' | 'ok';
  readonly summary: string;
  readonly pulse: boolean;
}

export function buildToolGroupUi(tools: ReadonlyArray<ToolTranscriptItem>): ToolGroupUi {
  const counts = tools.reduce(
    (acc, tool) => {
      acc[tool.status] += 1;
      return acc;
    },
    { ok: 0, error: 0, running: 0 },
  );
  const hasError = counts.error > 0;
  const hasRunning = counts.running > 0;
  return {
    accent: hasError ? '#ef4444' : hasRunning ? '#ec4899' : '#16a34a',
    tint: hasError ? '#fee2e2' : hasRunning ? '#fdf2f8' : '#ecfdf5',
    statusLabel: hasError ? 'failed' : hasRunning ? 'running' : 'ok',
    summary: [
      counts.ok > 0 ? `${counts.ok} ok` : '',
      counts.error > 0 ? `${counts.error} failed` : '',
      counts.running > 0 ? `${counts.running} running` : '',
    ].filter(Boolean).join(' · '),
    pulse: hasRunning && !hasError,
  };
}
