import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { LOGO_LINES, pickSlogan } from '../logo-data.js';

/**
 * ASCII banner shown at the top of the TUI. Big block-letter `MOXXY`
 * with a rotating slogan + version line underneath. Falls back to
 * single-line forms when the terminal is too narrow.
 */
export const Logo: React.FC<{ subtitle?: string; version?: string }> = ({
  subtitle,
  version,
}) => {
  const width = process.stdout.columns ?? 80;
  // Memoize so a re-render of the parent doesn't shuffle the slogan on
  // every keystroke; we want one pick per session/mount.
  const slogan = useMemo(() => pickSlogan(), []);

  if (width < 40) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="white">MOXXY</Text>
          {version ? <Text dimColor> v{version}</Text> : null}
        </Box>
        <Text dimColor italic>{slogan}</Text>
        {subtitle ? <Text dimColor> — {subtitle}</Text> : null}
      </Box>
    );
  }
  if (width < 60) {
    // Mid-width: just bold MOXXY, slogan, and any subtitle. The full
    // block banner would visibly overflow at 50ish columns.
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="white">M O X X Y</Text>
          {version ? <Text dimColor> v{version}</Text> : null}
        </Box>
        <Text dimColor italic>{slogan}</Text>
        {subtitle ? <Text dimColor> {subtitle}</Text> : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i} bold color="white">
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor italic>{slogan}</Text>
        {version ? <Text dimColor>{`  ·  v${version}`}</Text> : null}
      </Box>
      {subtitle ? (
        <Box>
          <Text dimColor> {subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
