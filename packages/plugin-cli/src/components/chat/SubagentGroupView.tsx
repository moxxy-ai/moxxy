import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../theme.js';
import { blockGap } from './density.js';
import {
  DotColors,
  formatTokensK,
  subagentGroupHeader,
  subagentState,
  subagentToolsLabel,
  truncate,
  type SubagentBlock,
  type SubagentGroupBlock,
} from '@moxxy/chat-model';

const LABEL_MAX = 60;
const ERROR_MAX = 80;

/**
 * Renders a folded run of sibling subagents (one `dispatch_agent` fan-out).
 *
 * Collapsed (default) — a single header row:
 *
 *   ▸ Agents · 4 Explore agents finished
 *
 * Expanded (Ctrl+O / `expandToolOutputs`) — a compact tree, one branch per
 * agent with a status sub-line:
 *
 *   ├ Find file-writing tools · 45 tool uses · 65.3k tokens
 *   │  └ Done
 *
 * Like the rest of the chat blocks this feeds Ink's `<Static>` region once the
 * group is settled (`isSettled` is true for a fully-completed group), so it
 * holds no live timers — the header verb flips to past tense on completion.
 */
export const SubagentGroupView: React.FC<{
  group: SubagentGroupBlock;
  expandToolOutputs: boolean;
}> = ({ group, expandToolOutputs }) => {
  const agents = group.agents;
  const failed = agents.some((a) => a.error != null);
  const busy = agents.some((a) => subagentState(a) === 'running' || subagentState(a) === 'background');
  const dotColor = failed ? Colors.danger : busy ? Colors.busy : DotColors.subagent;
  const header = subagentGroupHeader(group);

  if (!expandToolOutputs) {
    return (
      <Box marginTop={blockGap()} paddingLeft={2}>
        <Text dimColor>▸ </Text>
        <Text color={dotColor} bold>Agents</Text>
        <Text dimColor>{' · '}</Text>
        <Text>{header}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={blockGap()} paddingLeft={2}>
      <Box>
        <Text dimColor>▾ </Text>
        <Text color={dotColor} bold>Agents</Text>
        <Text dimColor>{' · '}</Text>
        <Text>{header}</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {agents.map((a) => (
          <SubagentRow key={a.id} agent={a} />
        ))}
      </Box>
    </Box>
  );
};

/** The status line under one agent of the group. */
export function subagentStatusText(agent: SubagentBlock): string {
  if (agent.error) return truncate(agent.error, ERROR_MAX);
  const state = subagentState(agent);
  if (state === 'running') return 'running';
  if (state === 'background') return 'going on in the background';
  return agent.continued === true ? 'Done in the background' : 'Done';
}

const SubagentRow: React.FC<{ agent: SubagentBlock }> = ({ agent }) => {
  const state = subagentState(agent);
  const tokens = formatTokensK(agent.tokensUsed);
  const toolPart = subagentToolsLabel(agent, 'use');
  const statusColor = agent.error ? Colors.danger : state === 'running' || state === 'background' ? Colors.busy : DotColors.subagent;
  const statusText = subagentStatusText(agent);
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{'├ '}</Text>
        <Text>{truncate(agent.label, LABEL_MAX)}</Text>
        {toolPart ? <Text dimColor>{` · ${toolPart}`}</Text> : null}
        {tokens ? <Text dimColor>{` · ${tokens} tokens`}</Text> : null}
      </Box>
      <Box>
        <Text dimColor>{'│  └ '}</Text>
        <Text color={statusColor}>{statusText}</Text>
      </Box>
    </Box>
  );
};
