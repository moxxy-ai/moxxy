import type { SubagentGroupTranscriptItem, SubagentStatus, SubagentTranscriptItem } from './chatTranscript';
import { buildToolDetailUi, type ToolDetailUi } from './toolGroupUi';

export interface SubagentDetailUi {
  readonly title: string;
  readonly subtitle: string;
  readonly statusLabel: string;
  readonly statusTone: SubagentStatus;
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
    statusLabel: subagentStatusLabel(agent),
    statusTone: agent.status,
    meta: buildMeta(agent),
    responseTitle: 'Response',
    responseText: agent.error || agent.responseText.trim() || agent.finalPreview || (agent.status === 'running' ? 'Working...' : agent.status === 'background' ? 'Went on in the background.' : 'No output captured.'),
    toolsTitle: 'Tools',
    emptyToolsText: agent.toolCalls.length === 0 ? 'No tools yet.' : null,
    tools: agent.toolCalls.map(buildToolDetailUi),
  };
}

/** How a helper stands, in a word or two; a helper reporting back from the background says so. */
export function subagentStatusLabel(agent: Pick<SubagentTranscriptItem, 'status' | 'continued'>): string {
  if (agent.status === 'failed') return 'Failed';
  if (agent.status === 'background') return 'In the background';
  if (agent.status === 'running') return 'running';
  return agent.continued === true ? 'Done in the background' : 'Done';
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
