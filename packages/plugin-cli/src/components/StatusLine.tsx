import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ModeBadge } from '@moxxy/sdk';
import { formatElapsed } from '@moxxy/chat-model';
import { Colors, Glyphs, contextColor, contextMarker, badgeBackground, badgeMarker } from '../theme.js';
import { Spinner } from './Spinner.js';
import { ModeFooter } from './ModeFooter.js';
import { MOTION_ENABLED } from './motion.js';

export interface StatusLineProps {
  /** Turn-in-flight marker. When set, shows the spinner + elapsed time. */
  readonly busyStartedAt?: number | null;
  /** Number of queued user messages (typed during a busy turn). */
  readonly queueCount?: number;
  /**
   * Active mode name. Shown on the left while idle (with the shift+tab
   * hint); replaced by the "Thinking" marker while a turn is in flight.
   */
  readonly modeName: string;
  /**
   * Presentation badge for the active mode, when it declares one (e.g. goal
   * mode). Unlike `modeName` this stays pinned to the left *even while a turn
   * is in flight*, so an autonomous mode is always visible — the whole point
   * being the user must never lose track that the agent is driving itself.
   */
  readonly modeBadge?: ModeBadge | null;
  /** Active provider name — rendered as a badge on the right. */
  readonly provider: string;
  /** Active model id — dim, after the badge. */
  readonly model: string;
  /** MCP attach summary. `enabled=0` hides the segment. */
  readonly mcp?: { readonly connected: number; readonly enabled: number };
  /** Tokens consumed so far (estimated). */
  readonly contextUsed?: number;
  /** Active model's context window size. Required for the bar. */
  readonly contextWindow?: number;
  /** Running CLI version — shown as a dim chip on the far right. */
  readonly version?: string;
  /** A newer published version, if any — turns the chip into an update hint. */
  readonly updateLatest?: string;
}

/**
 * Bottom status bar. Left side carries the in-flight indicator
 * (spinner + elapsed + queued count); right side carries the active
 * provider badge, model name, MCP attach count, and the context-usage
 * progress bar. Always rendered — when idle the left side is just
 * empty whitespace, the right side stays informational.
 */
export const StatusLine: React.FC<StatusLineProps> = ({
  busyStartedAt,
  queueCount,
  modeName,
  modeBadge,
  provider,
  model,
  mcp,
  contextUsed,
  contextWindow,
  version,
  updateLatest,
}) => {
  const busy = busyStartedAt != null;
  const showQueue = (queueCount ?? 0) > 0;
  const showMcp = !!(mcp && mcp.enabled > 0);
  const showCtx = !!(contextWindow && contextWindow > 0);
  const queuedTail = showQueue ? (
    <>
      <Text dimColor>{'  '}</Text>
      <Text dimColor>{`${Glyphs.contextUp} ${queueCount} queued`}</Text>
    </>
  ) : null;
  return (
    <Box justifyContent="space-between">
      <Box>
        {modeBadge ? (
          // Badged (autonomous) mode: the pill is pinned left at all times,
          // with the busy marker / idle hint trailing it — so the user always
          // sees the mode even mid-run, when a plain footer would be hidden.
          <>
            <ModeBadgePill badge={modeBadge} />
            <Text>{' '}</Text>
            {busy ? (
              <>
                <BusyMarker startedAt={busyStartedAt!} />
                {queuedTail}
              </>
            ) : (
              <Text color={Colors.chrome} dimColor>
                {'Esc stops · shift+tab to change'}
              </Text>
            )}
          </>
        ) : busy ? (
          <>
            <BusyMarker startedAt={busyStartedAt!} />
            {queuedTail}
          </>
        ) : (
          <ModeFooter modeName={modeName} />
        )}
      </Box>
      <Box>
        <ProviderBadge name={provider} />
        <Text dimColor>{`  ${model}`}</Text>
        {showMcp ? (
          <>
            <Text dimColor>{`  ${Glyphs.midDot}  `}</Text>
            <Text dimColor>mcp </Text>
            <Text>{`${mcp!.connected}/${mcp!.enabled}`}</Text>
          </>
        ) : null}
        {showCtx ? (
          <>
            <Text dimColor>{`  ${Glyphs.midDot}  `}</Text>
            <ContextMeter used={contextUsed ?? 0} total={contextWindow!} />
          </>
        ) : null}
        {version ? (
          <>
            <Text dimColor>{`  ${Glyphs.midDot}  `}</Text>
            {updateLatest ? (
              <Text color="yellow">{`v${version} ${Glyphs.contextUp}${updateLatest}`}</Text>
            ) : (
              <Text dimColor>{`v${version}`}</Text>
            )}
          </>
        ) : null}
      </Box>
    </Box>
  );
};

const ProviderBadge: React.FC<{ name: string }> = ({ name }) => (
  <Text backgroundColor={Colors.chrome} color="black" bold>{` ${name} `}</Text>
);

/**
 * Reverse-video pill for a badged mode (e.g. ` GOAL `). The accent
 * background is the mode's most prominent signal — it reads as "this
 * session is in a special, autonomous state" at a glance.
 */
const ModeBadgePill: React.FC<{ badge: ModeBadge }> = ({ badge }) => (
  <Text backgroundColor={badgeBackground(badge.tone)} color="black" bold>
    {` ${badgeMarker(badge.tone)}${badge.label} `}
  </Text>
);

const BusyMarker: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!MOTION_ENABLED) return; // freeze the elapsed clock for reduced-motion / non-TTY
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Box>
      <Spinner color={Colors.busy} />
      <Text color={Colors.busy}>{' Thinking'}</Text>
      <Text dimColor>{`  [${formatElapsed(now - startedAt)}]`}</Text>
    </Box>
  );
};

const CONTEXT_BAR_WIDTH = 10;

const ContextMeter: React.FC<{ used: number; total: number }> = ({ used, total }) => {
  const pct = Math.min(100, Math.round((used / total) * 100));
  const color = contextColor(pct);
  const filled = Math.round((pct / 100) * CONTEXT_BAR_WIDTH);
  const empty = CONTEXT_BAR_WIDTH - filled;
  return (
    <Box>
      <Text {...(color ? { color } : {})}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text {...(color ? { color } : { dimColor: true })}>{` ${pct}%${contextMarker(pct)}`}</Text>
    </Box>
  );
};
