import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Colors, Glyphs } from '../../theme.js';
import { formatElapsed, truncate, type CollaborationBlock } from '@moxxy/chat-model';

const MAX_AGENTS = 8;
const MAX_TASKS = 6;
const MAX_MSGS = 6;

/** Compact, height-bounded TUI view of a collaborative run: header + roster +
 *  board + contracts + the recent message bus. Mirrors SubagentScopeView's
 *  ticking-elapsed style. */
export const CollabScopeView: React.FC<{ scope: CollaborationBlock }> = ({ scope }) => {
  const [now, setNow] = useState(() => Date.now());
  const running = scope.completedAtMs == null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = formatElapsed((scope.completedAtMs ?? now) - scope.startedAtMs);
  const done = scope.agents.filter((a) => a.status === 'done').length;
  const state = running
    ? scope.control?.paused
      ? 'paused'
      : 'running'
    : scope.conflicts.length > 0
      ? 'done · conflicts'
      : 'done';
  const headColor = scope.conflicts.length > 0 ? Colors.danger : Colors.busy;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={headColor}>{Glyphs.filled} </Text>
        <Text bold>collab </Text>
        <Text>{truncate(scope.task, 50)}</Text>
        <Text dimColor>{`  ${state} ${elapsed} · ${done}/${scope.agents.length} done`}</Text>
      </Box>
      {scope.fallbackReason ? (
        <Box marginLeft={2}>
          <Text dimColor>{`! ${truncate(scope.fallbackReason, 90)}`}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginLeft={2}>
        {scope.agents.slice(0, MAX_AGENTS).map((a) => {
          const glyph = a.status === 'done' ? '✓' : a.status === 'working' ? '●' : a.status === 'crashed' ? '✗' : '○';
          const statusProps =
            a.status === 'working'
              ? { color: Colors.busy }
              : a.status === 'crashed'
                ? { color: Colors.danger }
                : { dimColor: true };
          return (
            <Box key={a.id}>
              <Text {...statusProps}>{glyph} </Text>
              <Text>{a.name}</Text>
              <Text dimColor>{`  ${a.role} · ${a.status}`}</Text>
            </Box>
          );
        })}
        {scope.agents.length > MAX_AGENTS ? (
          <Text dimColor>{`  +${scope.agents.length - MAX_AGENTS} more`}</Text>
        ) : null}
      </Box>
      {scope.tasks.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>{`board (${scope.tasks.filter((t) => t.status === 'done').length}/${scope.tasks.length})`}</Text>
          {scope.tasks.slice(0, MAX_TASKS).map((t) => (
            <Text key={t.id} dimColor>{`  [${t.status}] ${truncate(t.title, 40)}${t.owner ? ` @${t.owner}` : ''}`}</Text>
          ))}
        </Box>
      ) : null}
      {scope.contracts.length > 0 ? (
        <Box marginLeft={2}>
          <Text dimColor>{`contracts: ${truncate(scope.contracts.map((c) => c.title).join(', '), 80)}`}</Text>
        </Box>
      ) : null}
      {scope.messages.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {scope.messages.slice(-MAX_MSGS).map((m) => (
            <Text key={m.id} dimColor>{`  ${m.from} → ${m.to}: ${truncate(m.body, 70)}`}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
