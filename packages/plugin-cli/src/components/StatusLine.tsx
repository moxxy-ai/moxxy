import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { GovernanceInfo, ModeBadge } from '@moxxy/sdk';
import { formatTokensK } from '@moxxy/chat-model';
import { Colors, Glyphs } from '../theme.js';
import { terminalSafeText } from './terminal-text.js';

export interface StatusLineProps {
  /** Optional safety tone for an elevated mode; it still occupies only the mode slot. */
  readonly modeBadge?: ModeBadge | null;
  /** Active run behavior. Always visible; Shift+Tab cycles it. */
  readonly modeName: string;
  /** Active provider model. Always visible in the persistent status edge. */
  readonly modelName: string;
  /** Estimated tokens currently occupying the active context window. */
  readonly contextUsed: number;
  /** Model context limit when known. */
  readonly contextWindow?: number | null;
  /** Governed workspaces keep their safety state visible; local is implicit. */
  readonly governance?: GovernanceInfo | null;
}

/**
 * Quiet bottom edge of the product frame. Activity belongs in the transcript;
 * this persistent line carries only the active execution contract.
 */
export const StatusLine: React.FC<StatusLineProps> = ({
  modeBadge,
  modeName,
  modelName,
  contextUsed,
  contextWindow,
  governance,
}) => {
  const columns = useTerminalColumns();
  const tiny = columns < 58;
  const visibleModel = terminalSafeText(
    modelName || 'no model',
    tiny ? 10 : columns < 100 ? 18 : 28,
  );
  const visibleMode = terminalSafeText(modeBadge?.label ?? (modeName || 'default'), tiny ? 9 : 18);
  const context = formatContextRemaining(contextUsed, contextWindow, columns >= 110);
  return (
    <Box justifyContent="space-between" width="100%">
      <Box>
        <Text
          bold
          color={
            modeBadge?.tone === 'attention'
              ? Colors.busy
              : modeBadge
                ? Colors.active
                : undefined
          }
        >
          {visibleMode}
        </Text>
        {governance ? (
          <>
            <Text dimColor>{` ${Glyphs.midDot} `}</Text>
            <Text color={governance.stale ? Colors.busy : Colors.active} bold>
              {governance.stale ? 'MANAGED!' : 'MANAGED'}
            </Text>
            <Text dimColor>
              {` ${Glyphs.midDot} ${terminalSafeText(governance.label, tiny ? 10 : 24)}`}
            </Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text>{visibleModel}</Text>
        <Text dimColor>{` ${Glyphs.midDot} ${context}`}</Text>
      </Box>
    </Box>
  );
};

export function formatContextRemaining(
  used: number,
  window: number | null | undefined,
  detailed = false,
): string {
  if (window == null || !Number.isFinite(window) || window <= 0) return 'ctx —';
  const boundedUsed = Number.isFinite(used) ? Math.max(0, used) : 0;
  const remaining = Math.max(0, window - boundedUsed);
  const percent = Math.max(0, Math.min(100, Math.round((remaining / window) * 100)));
  if (!detailed) return `ctx ${percent}% left`;
  return `ctx ${formatTokensK(Math.round(remaining)) ?? '0'} left`;
}

function useTerminalColumns(): number {
  const [columns, setColumns] = useState(() => process.stdout.columns ?? 80);
  useEffect(() => {
    const onResize = (): void => setColumns(process.stdout.columns ?? 80);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return columns;
}
