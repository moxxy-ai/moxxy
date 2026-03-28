import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

const LOGO_LINES = [
  '███╗   ███╗ ██████╗ ██╗  ██╗██╗  ██╗██╗   ██╗',
  '████╗ ████║██╔═══██╗╚██╗██╔╝╚██╗██╔╝╚██╗ ██╔╝',
  '██╔████╔██║██║   ██║ ╚███╔╝  ╚███╔╝  ╚████╔╝ ',
  '██║╚██╔╝██║██║   ██║ ██╔██╗  ██╔██╗   ╚██╔╝  ',
  '██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗██╔╝ ██╗   ██║   ',
  '╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ',
];

function computeContextUtilization(contextTokens, contextWindow) {
  const windowSize = Number(contextWindow) || 0;
  if (windowSize <= 0) return { hasWindow: false, percent: 0, band: 'low' };
  const tokens = Number(contextTokens) || 0;
  const percent = Math.min(100, Math.max(0, Math.round((tokens / windowSize) * 100)));
  if (percent <= 60) return { hasWindow: true, percent, band: 'low' };
  if (percent <= 80) return { hasWindow: true, percent, band: 'medium' };
  return { hasWindow: true, percent, band: 'high' };
}

export { computeContextUtilization };

export function Header({ agent }) {
  const model = agent ? `${agent.provider_id}/${agent.model_id}` : '';
  const name = agent?.name || 'connecting...';

  return (
    <Box width="100%" flexDirection="column" flexShrink={0}>
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={THEME.text}>  {line}</Text>
        ))}
        <Text>
          <Text color={THEME.user}>  {name}</Text>
          <Text color={THEME.dim}> · </Text>
          <Text color={THEME.dim}>{model || '-'}</Text>
        </Text>
      </Box>
      <Box width="100%" borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false} borderColor={THEME.dim} />
    </Box>
  );
}
