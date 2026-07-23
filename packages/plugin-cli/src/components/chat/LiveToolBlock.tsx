import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Glyphs } from '../../theme.js';
import { ToolCallBlock, toolGlyph } from './ToolCallBlock.js';
import { ShimmerText } from './ShimmerText.js';
import {
  buildCompactSummary,
  compactPreviewLine,
  type LiveToolBlockData,
} from '@moxxy/chat-model';

/**
 * Renders a run of consecutive "compact" tool calls as one live block.
 * Collapsed (default):
 *
 *     Reading 3 files, searching for 1 pattern… (ctrl+o to expand)
 *       └ packages/plugin-cli/src/components/chat/pair-events.ts
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
  const summary = buildCompactSummary(block.calls, inFlight);
  const latest = block.calls[block.calls.length - 1];
  // Errors among the latest few calls get surfaced even when collapsed —
  // a silent failure inside a live block would be confusing.
  const errorCount = block.calls.reduce((n, c) => {
    const o = c.outcome;
    if (!o) return n;
    if (o.type === 'denied') return n + 1;
    return n + (o.ok ? 0 : 1);
  }, 0);

  return (
    <Box flexDirection="column" marginTop={nested ? 0 : 1}>
      <Box>
        {nested ? <Text dimColor>└ </Text> : null}
        <Text dimColor>{latest ? toolGlyph(latest.request.name) : Glyphs.pending} </Text>
        <ShimmerText text={summary} active={inFlight} />
        {!showDetails ? <Text dimColor>{'  ›'}</Text> : null}
      </Box>
      {errorCount > 0 && !showDetails ? (
        <Box marginLeft={2}>
          <Text color={Colors.danger}>
            {errorCount} {errorCount === 1 ? 'call' : 'calls'} failed — press ctrl+o for detail
          </Text>
        </Box>
      ) : null}
      {!showDetails && latest ? (
        <Box marginLeft={2}>
          <Text dimColor>└ </Text>
          <Text dimColor>{compactPreviewLine(latest)}</Text>
        </Box>
      ) : null}
      {showDetails ? (
        <Box flexDirection="column" marginLeft={2}>
          {block.calls.map((c) => (
            <ToolCallBlock key={c.id} request={c.request} outcome={c.outcome} nested />
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
