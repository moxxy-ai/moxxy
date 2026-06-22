import type { SubagentGroupTranscriptItem, SubagentTranscriptItem } from './chatTranscript';
import { buildToolDetailUi, type ToolDetailUi } from './toolGroupUi';

export interface SubagentDetailUi {
  readonly title: string;
  readonly subtitle: string;
  readonly statusLabel: string;
  readonly statusTone: 'running' | 'done' | 'failed';
  readonly meta: string;
  readonly responseTitle: 'Response';
  readonly responseText: string;
  readonly toolsTitle: 'Tools';
  readonly emptyToolsText: string | null;
  readonly tools: ReadonlyArray<ToolDetailUi>;
}

export function buildSubagentDetailUi(agent: SubagentTranscriptItem): SubagentDetailUi {
  return {
    title: agent.label,
    subtitle: `${agent.agentType || 'default'} subagent`,
    statusLabel: agent.status === 'done' ? 'Done' : agent.status === 'failed' ? 'Failed' : 'running',
    statusTone: agent.status,
    meta: buildMeta(agent),
    responseTitle: 'Response',
    responseText: agent.error || agent.responseText.trim() || agent.finalPreview || (agent.status === 'running' ? 'Working...' : 'No output captured.'),
    toolsTitle: 'Tools',
    emptyToolsText: agent.toolCalls.length === 0 ? 'No tools yet.' : null,
    tools: agent.toolCalls.map(buildToolDetailUi),
  };
}

export function selectSubagentDetailAgent(
  group: SubagentGroupTranscriptItem,
  selectedAgentId: string | null,
): SubagentTranscriptItem | null {
  if (!selectedAgentId) return null;
  return group.agents.find((agent) => agent.id === selectedAgentId) ?? null;
}

function buildMeta(agent: SubagentTranscriptItem): string {
  return [
    `${agent.toolCallCount} ${agent.toolCallCount === 1 ? 'tool' : 'tools'}`,
    formatTokens(agent.tokensUsed),
    agent.stopReason,
  ].filter((part): part is string => Boolean(part)).join(' · ');
}

function formatTokens(tokens: number | null): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${tokens} tokens`;
}
