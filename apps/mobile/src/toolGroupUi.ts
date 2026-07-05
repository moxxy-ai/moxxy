import type { ToolTranscriptItem } from './chatTranscript';

export interface ToolGroupUi {
  readonly statusLabel: 'failed' | 'running' | 'ok';
  readonly summary: string;
  readonly pulse: boolean;
}

export interface ToolDetailInput {
  readonly id: string;
  readonly name: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly summary: string;
  readonly resultSummary?: string | null;
  readonly error?: string | null;
}

export interface ToolDetailUi {
  readonly id: string;
  readonly name: string;
  readonly statusLabel: 'failed' | 'running' | 'ok';
  readonly statusTone: 'running' | 'ok' | 'error';
  readonly summary: string;
  readonly detailLabel: 'Input' | 'Result' | 'Error';
  readonly detail: string | null;
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
    statusLabel: hasError ? 'failed' : hasRunning ? 'running' : 'ok',
    summary: [
      counts.ok > 0 ? `${counts.ok} ok` : '',
      counts.error > 0 ? `${counts.error} failed` : '',
      counts.running > 0 ? `${counts.running} running` : '',
    ].filter(Boolean).join(' · '),
    pulse: hasRunning && !hasError,
  };
}

export function buildToolDetailUi(tool: ToolDetailInput): ToolDetailUi {
  const error = normalizeText(tool.error);
  const result = normalizeText(tool.resultSummary);
  return {
    id: tool.id,
    name: tool.name,
    statusLabel: tool.status === 'error' ? 'failed' : tool.status,
    statusTone: tool.status,
    summary: tool.summary,
    detailLabel: error ? 'Error' : result ? 'Result' : 'Input',
    detail: error || result || normalizeText(tool.summary) || null,
  };
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
