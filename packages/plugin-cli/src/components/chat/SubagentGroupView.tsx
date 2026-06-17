import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Glyphs } from '../../theme.js';
import {
  DotColors,
  formatTokensK,
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
 *   ● 4 Explore agents finished (ctrl+o to expand)
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
  const total = agents.length;
  const running = agents.filter((a) => a.completedAtMs == null && a.error == null).length;
  const failed = agents.filter((a) => a.error != null).length;
  const anyRunning = running > 0;
  const dotColor = failed > 0 ? Colors.danger : anyRunning ? Colors.busy : DotColors.subagent;

  // "N {type} agents {verb}" — drop the type word for a mixed fan-out, use the
  // singular noun for a lone agent, and append a failure tail when any failed.
  const typeWord = group.agentType === 'mixed' ? '' : `${group.agentType} `;
  const noun = total === 1 ? 'agent' : 'agents';
  const verb = anyRunning ? 'running' : 'finished';
  const failTail = failed > 0 ? ` (${failed} failed)` : '';
  const header = `${total} ${typeWord}${noun} ${verb}${failTail}`;

  if (!expandToolOutputs) {
    return (
      <Box marginTop={1}>
        <Text color={dotColor}>{Glyphs.filled} </Text>
        <Text>{header}</Text>
        <Text dimColor>{' (ctrl+o to expand)'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={dotColor}>{Glyphs.filled} </Text>
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

const SubagentRow: React.FC<{ agent: SubagentBlock }> = ({ agent }) => {
  const running = agent.completedAtMs == null && agent.error == null;
  const tokens = formatTokensK(agent.tokensUsed);
  const toolPart = `${agent.toolCallCount} tool use${agent.toolCallCount === 1 ? '' : 's'}`;
  const statusColor = agent.error ? Colors.danger : running ? Colors.busy : DotColors.subagent;
  const statusText = agent.error
    ? truncate(agent.error, ERROR_MAX)
    : running
      ? 'running'
      : 'Done';
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{'├ '}</Text>
        <Text>{truncate(agent.label, LABEL_MAX)}</Text>
        <Text dimColor>{` · ${toolPart}`}</Text>
        {tokens ? <Text dimColor>{` · ${tokens} tokens`}</Text> : null}
      </Box>
      <Box>
        <Text dimColor>{'│  └ '}</Text>
        <Text color={statusColor}>{statusText}</Text>
      </Box>
    </Box>
  );
};
