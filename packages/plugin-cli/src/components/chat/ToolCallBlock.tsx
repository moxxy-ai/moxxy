import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { isFileDiffDisplay, type FileDiffDisplay, type ToolCallRequestedEvent, type ToolResultEvent } from '@moxxy/sdk';
import { Colors, Glyphs } from '../../theme.js';
import { dotColorForTool, isFileDiffResult, oneLine, stringify, summarizeArgs, truncate } from '@moxxy/chat-model';
import { FileDiffView } from './FileDiffView.js';
import { MOTION_ENABLED } from '../motion.js';


/**
 * Pulsing `●` for in-flight tool calls. Toggles between full color and
 * dim every ~500ms so the user can tell at a glance that work is still
 * happening — a static yellow dot was reading as "stuck" when a long
 * shell command was running. The trailing space lives outside the
 * dimmed Text so the dim ANSI attribute can't bleed onto the tool name
 * that follows (some terminals interpret the boundary loosely and the
 * whole row appeared to pulse).
 */
const PendingBullet: React.FC = () => {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!MOTION_ENABLED) return; // static (non-blinking) dot for reduced-motion / non-TTY
    const t = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Text color={Colors.busy} dimColor={!on}>{Glyphs.filled}</Text>
      <Text> </Text>
    </>
  );
};

/** Cap displayed identifier length so an oversized MCP/skill name
 *  doesn't blow the header off the right edge of the terminal. */
const NAME_DISPLAY_MAX = 48;

export const ToolCallBlock: React.FC<{
  request: ToolCallRequestedEvent;
  outcome: ToolResultEvent | { type: 'denied'; reason: string } | null;
  /** Global Ctrl+O toggle — expands file-diff previews to their full set. */
  expanded?: boolean;
}> = ({ request, outcome, expanded = false }) => {
  // A settled Write/Edit result renders as a full diff card (its own header,
  // summary, and changed slices) instead of the generic outcome line.
  if (isFileDiffResult(outcome)) {
    const display = (outcome.output as { display: FileDiffDisplay }).display;
    if (isFileDiffDisplay(display)) {
      return <FileDiffView display={display} expanded={expanded} />;
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
  const argSummary = summarizeArgs(request.input);
  const nameLabel = truncate(request.name, NAME_DISPLAY_MAX);
  const detail = argSummary ? `${nameLabel}, ${argSummary}` : nameLabel;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        {status === 'pending' ? (
          <PendingBullet />
        ) : status === 'err' ? (
          // Distinct glyph (✗), not color alone, so a failed call is
          // distinguishable from a successful one in a no-color / colorblind
          // terminal — the dots were otherwise an identical filled '●'.
          <Text color={Colors.danger}>✗ </Text>
        ) : (
          <Text color={dotColorForTool(request.name)}>{Glyphs.filled} </Text>
        )}
        <Text bold>Tool</Text>
        <Text dimColor>{` (${detail})`}</Text>
      </Box>
      {outcome ? (
        <Box>
          <Text dimColor>  └ </Text>
          <OutcomeText outcome={outcome} />
        </Box>
      ) : null}
    </Box>
  );
};

const OutcomeText: React.FC<{
  outcome: ToolResultEvent | { type: 'denied'; reason: string };
}> = ({ outcome }) => {
  if (outcome.type === 'denied') {
    return <Text color={Colors.danger}>denied: {outcome.reason}</Text>;
  }
  if (!outcome.ok) {
    return (
      <Text color={Colors.danger}>
        {outcome.error?.kind ?? 'error'}: {outcome.error?.message}
      </Text>
    );
  }
  const preview = oneLine(stringify(outcome.output));
  return <Text dimColor>{truncate(preview, 100)}</Text>;
};
