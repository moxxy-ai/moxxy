import React from 'react';
import { Box, Text } from 'ink';

interface Run {
  readonly kind: 'x' | 'colon' | 'space';
  readonly text: string;
}

/**
 * Break a logo row into runs of consecutive same-class chars: `X`
 * outlines, `:` fill, and surrounding spaces. The renderer styles each
 * class differently so the X structure reads crisp while the fill
 * recedes — same trick the SVG mark uses via stroke weight.
 */
function splitRuns(line: string): ReadonlyArray<Run> {
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (const ch of line) {
    const kind: Run['kind'] = ch === 'X' ? 'x' : ch === ':' ? 'colon' : 'space';
    if (cur && cur.kind === kind) {
      cur = { kind, text: cur.text + ch };
      runs[runs.length - 1] = cur;
    } else {
      cur = { kind, text: ch };
      runs.push(cur);
    }
  }
  return runs;
}

/**
 * One row of the ASCII logo with class-aware styling: `X` strokes
 * inherit the default foreground (white on dark themes, black on
 * light), `:` fill renders dim gray, spaces stay invisible. Used by
 * both `<Logo />` (post-boot TUI header) and `<BootScreen />`.
 */
export const LogoLine: React.FC<{ text: string }> = ({ text }) => (
  <Box>
    {splitRuns(text).map((run, i) =>
      run.kind === 'colon' ? (
        <Text key={i} color="gray" dimColor>
          {run.text}
        </Text>
      ) : (
        <Text key={i}>{run.text}</Text>
      ),
    )}
  </Box>
);
