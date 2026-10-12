import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Colors, Glyphs } from '../../theme.js';
import { blockGap } from './density.js';
import { DotColors, formatElapsed, subagentState, subagentToolsLabel, truncate, type SubagentBlock } from '@moxxy/chat-model';
import { MOTION_ENABLED } from '../motion.js';

export const SubagentScopeView: React.FC<{ scope: SubagentBlock }> = ({ scope }) => {
  const [now, setNow] = useState(() => Date.now());
  const state = subagentState(scope);
  const running = state === 'running';
  useEffect(() => {
    if (!running || !MOTION_ENABLED) return; // skip per-second ticking for reduced-motion / non-TTY
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const endMs = scope.completedAtMs ?? now;
  const elapsed = formatElapsed(endMs - scope.startedAtMs);
  const toolPart = subagentToolsLabel(scope, 'call');
  const dotColor = scope.error
    ? Colors.danger
    : running || state === 'background'
      ? Colors.busy
      : DotColors.subagent;
  const stateText = state === 'background' ? 'in the background' : scope.continued === true && state === 'done' ? 'done in the background' : state;
  return (
    <Box flexDirection="column" marginTop={blockGap()}>
      <Box>
        <Text color={dotColor}>{Glyphs.filled} </Text>
        <Text bold>{`agent `}</Text>
        <Text>{scope.label}</Text>
        <Text dimColor>{`  ${stateText}${state === 'background' ? '' : ` ${elapsed}`}${toolPart ? ` · ${toolPart}` : ''}`}</Text>
      </Box>
      {scope.error ? (
        <Box marginLeft={2}>
          <Text dimColor>└ </Text>
          <Text color={Colors.danger}>{truncate(scope.error, 100)}</Text>
        </Box>
      ) : scope.finalPreview && !running ? (
        <Box marginLeft={2}>
          <Text dimColor>{`└ ${truncate(scope.finalPreview, 100)}`}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
