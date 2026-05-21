import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { LOGO_LINES, pickSlogan } from '../logo-data.js';
import { LogoLine } from './LogoLine.js';

/**
 * ASCII banner shown at the top of the TUI. The `|X|` mark from
 * moxxy.ai/logo.svg rendered with `X` strokes in default white and
 * `:` fill dimmed, plus a rotating slogan. Falls back to a single-line
 * text form on very narrow terminals.
 */
export const Logo: React.FC<{ subtitle?: string }> = ({ subtitle }) => {
  const width = process.stdout.columns ?? 80;
  // Memoize so a re-render of the parent doesn't shuffle the slogan on
  // every keystroke; we want one pick per session/mount.
  const slogan = useMemo(() => pickSlogan(), []);

  if (width < 20) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Text>|X|  moxxy</Text>
        <Text dimColor italic>{slogan}</Text>
        {subtitle ? <Text dimColor> {subtitle}</Text> : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO_LINES.map((line, i) => (
        <LogoLine key={i} text={line} />
      ))}
      <Box marginTop={1}>
        <Text dimColor italic>{slogan}</Text>
      </Box>
      {subtitle ? (
        <Box>
          <Text dimColor> {subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
