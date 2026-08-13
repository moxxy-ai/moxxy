import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../theme.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { ActivityDot } from './ActivityDot.js';
import {
  buildCompactSummary,
  truncate,
  type LiveToolBlockData,
} from '@moxxy/chat-model';

/**
 * Renders a run of consecutive "compact" tool calls as one live block.
 * Collapsed (default):
 *
 *     ▸ Tools · Read 3 files, searched 1 pattern
 *
 * Expanded (Ctrl+O on):
 *
 *     Reading 3 files, searching for 1 pattern…
 *       ● Read(file_path="…")
 *       ● Read(file_path="…")
 *       ● Grep(pattern="…")
 *       …
 *
 * The summary line refreshes as new calls land; the bottom preview line
 * always shows the most recent call's target. Once the block is closed
 * (assistant message or new turn) the contents freeze.
 */
export const LiveToolBlock: React.FC<{
  block: LiveToolBlockData;
  /** Global Ctrl+O toggle. */
  expanded: boolean;
  /** Compact child row beneath a skill activity header. */
  nested?: boolean;
}> = ({ block, expanded, nested = false }) => {
  // An aggregate may remain open for another adjacent compact call after the
  // latest result settles. Animate actual pending work, not that grouping
  // window, otherwise a completed read/search keeps shimmering indefinitely.
  const inFlight = block.calls.some((call) => call.outcome === null);
  const showDetails = expanded || inFlight;
  const summary = truncate(
    buildCompactSummary(block.calls, inFlight),
    Math.max(24, (process.stdout.columns ?? 80) - (nested ? 14 : 10)),
  );
  // Errors among the latest few calls get surfaced even when collapsed —
  // a silent failure inside a live block would be confusing.
  const errorCount = block.calls.reduce((n, c) => {
    const o = c.outcome;
    if (!o) return n;
    if (o.type === 'denied') return n + 1;
    return n + (o.ok ? 0 : 1);
  }, 0);

  return (
    <Box
      flexDirection="column"
      marginTop={nested ? 0 : 1}
      paddingLeft={nested ? 0 : 2}
    >
      <Box>
        {nested ? <Text dimColor>└ </Text> : null}
        <ActivityDot state={errorCount > 0 && !inFlight ? 'error' : inFlight ? 'active' : 'success'} />
        <Text> </Text>
        <Text bold>Tools</Text>
        <Text dimColor>{' · '}</Text>
        <Text dimColor>{summary}</Text>
        {!nested && !inFlight ? (
          <Text dimColor>{`  ·  Ctrl+O ${showDetails ? 'collapse' : 'details'}`}</Text>
        ) : null}
      </Box>
      {errorCount > 0 && !showDetails ? (
        <Box marginLeft={2}>
          <Text color={Colors.danger}>
            {errorCount} {errorCount === 1 ? 'call' : 'calls'} failed
          </Text>
        </Box>
      ) : null}
      {showDetails ? (
        <Box flexDirection="column" marginLeft={2}>
          {block.calls.map((c) => (
            <ToolCallBlock
              key={c.id}
              request={c.request}
              outcome={c.outcome}
              expanded={expanded}
              nested
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
