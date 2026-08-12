import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import {
  COMPACT_LOGO_LINES,
  COMPACT_LOGO_WIDTH,
  pickSlogan,
  selectLogo,
  WORDMARK_MIN_WIDTH,
} from '../logo-data.js';
import { LogoLine } from './LogoLine.js';

/**
 * Banner shown at the top of the TUI: the moxxy mark rendered dim-gray,
 * plus a rotating slogan. Steps down to the `MOXXY` wordmark and then a
 * one-line text mark on narrower terminals (see `selectLogo`).
 */
export const Logo: React.FC<{
  readonly subtitle?: string;
  /** Keep the welcome below one terminal viewport by using the wordmark. */
  readonly compact?: boolean;
  /** Fixed product promise for onboarding; omitted keeps the rotating slogan. */
  readonly slogan?: string;
}> = ({ subtitle, compact = false, slogan: sloganOverride }) => {
  const width = process.stdout.columns ?? 80;
  // Memoize so a re-render of the parent doesn't shuffle the slogan on
  // every keystroke; we want one pick per session/mount.
  const pickedSlogan = useMemo(() => pickSlogan(), []);
  const slogan = sloganOverride ?? pickedSlogan;
  const lines = compact && width >= Math.max(WORDMARK_MIN_WIDTH, COMPACT_LOGO_WIDTH + 2)
    ? COMPACT_LOGO_LINES
    : selectLogo(width).lines;

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      {...(compact ? { width: '100%', alignItems: 'center' as const } : {})}
    >
      {lines.map((line, i) => (
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
