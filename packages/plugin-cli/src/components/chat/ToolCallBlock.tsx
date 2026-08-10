import React from 'react';
import { Box, Text } from 'ink';
import { isFileDiffDisplay, type FileDiffDisplay, type ToolCallRequestedEvent, type ToolResultEvent } from '@moxxy/sdk';
import { Colors } from '../../theme.js';
import { formatToolActivity, isFileDiffResult, oneLine, stringify, truncate } from '@moxxy/chat-model';
import { FileDiffView } from './FileDiffView.js';

export const ToolCallBlock: React.FC<{
  request: ToolCallRequestedEvent;
  outcome: ToolResultEvent | { type: 'denied'; reason: string } | null;
  /** Global Ctrl+O toggle — expands result previews and full file diffs. */
  expanded?: boolean;
  /** Compact child row beneath a skill/live activity header. */
  nested?: boolean;
}> = ({ request, outcome, expanded = false, nested = false }) => {
  // A settled Write/Edit result renders as a full diff card (its own header,
  // summary, and changed slices) instead of the generic outcome line.
  if (isFileDiffResult(outcome)) {
    const display = (outcome.output as { display: FileDiffDisplay }).display;
    if (isFileDiffDisplay(display)) {
      return (
        <Box paddingLeft={nested ? 0 : 2}>
          <FileDiffView display={display} expanded={expanded} showToggle={!nested} />
        </Box>
      );
    }
  }
  const status: 'pending' | 'ok' | 'err' =
    outcome === null
      ? 'pending'
      : outcome.type === 'denied'
        ? 'err'
        : outcome.ok
          ? 'ok'
          : 'err';
  const columns = process.stdout.columns ?? 80;
  const transcriptColumns = Math.min(108, columns);
  const detail = truncate(
    formatToolActivity(request.name, request.input, status === 'pending'),
    Math.max(24, transcriptColumns - (nested ? 8 : 4)),
  );
  return (
    <Box
      flexDirection="column"
      marginTop={nested ? 0 : 1}
      paddingLeft={nested ? 0 : 2}
    >
      <Box>
        {nested ? <Text dimColor>└ </Text> : null}
        <Text
          color={status === 'err' ? Colors.danger : status === 'ok' ? Colors.active : undefined}
          dimColor={status === 'pending'}
        >
          {status === 'err' ? '✗' : status === 'ok' ? '✓' : toolGlyph(request.name)}{' '}
        </Text>
        <Text dimColor>{detail}</Text>
        {status === 'err' ? <Text color={Colors.danger}> failed</Text> : null}
        {!nested && status === 'ok' ? (
          <Text dimColor>{` · Ctrl+O ${expanded ? 'collapse' : 'result'}`}</Text>
        ) : null}
      </Box>
      {outcome && (expanded || status === 'err') ? (
        <Box marginLeft={nested ? 4 : 2}>
          <OutcomeText outcome={outcome} />
        </Box>
      ) : null}
    </Box>
  );
};

export function toolGlyph(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === 'read' || normalized === 'glob') return '▱';
  if (normalized === 'grep' || normalized.includes('search')) return '⌕';
  if (normalized === 'bash' || normalized.includes('command')) return '›';
  return '◇';
}

const OutcomeText: React.FC<{
  outcome: ToolResultEvent | { type: 'denied'; reason: string };
}> = ({ outcome }) => {
  if (outcome.type === 'denied') {
    return <Text color={Colors.danger}>Result · denied: {outcome.reason}</Text>;
  }
  if (!outcome.ok) {
    return (
      <Text color={Colors.danger}>
        Result · {outcome.error?.kind ?? 'error'}: {outcome.error?.message}
      </Text>
    );
  }
  const preview = oneLine(stringify(outcome.output));
  const maxWidth = Math.max(24, Math.min(108, process.stdout.columns ?? 80) - 12);
  return <Text dimColor>{`Result · ${truncate(preview, maxWidth)}`}</Text>;
};
