import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function HiveStatus({ msg }) {
  const total = msg.totalTasks || 0;
  const completed = msg.completedTasks || 0;
  const inProgress = msg.inProgressTasks || 0;
  const workers = msg.workers || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const barWidth = 20;
  const filled = total > 0 ? Math.round((completed / total) * barWidth) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

  const statusParts = [];
  if (workers > 0) statusParts.push(`${workers} workers`);
  if (inProgress > 0) statusParts.push(`${inProgress} active`);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color={THEME.warning}>Hive</Text>
        <Text color={THEME.dim}> [{bar}] {completed}/{total} ({pct}%)</Text>
      </Text>
      {statusParts.length > 0 && (
        <Text color={THEME.dim}>{statusParts.join(' · ')}</Text>
      )}
      {(msg.recentEvents || []).map((evt, i) => (
        <Text key={i} color={THEME.dim}>{evt}</Text>
      ))}
    </Box>
  );
}
