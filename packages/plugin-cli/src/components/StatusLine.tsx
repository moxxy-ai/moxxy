import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ClientChromeItem, GovernanceInfo, ModeBadge } from '@moxxy/sdk';
import { formatElapsed, formatTokensK } from '@moxxy/chat-model';
import { Colors, Glyphs, badgeBackground, badgeMarker } from '../theme.js';
import { Spinner } from './Spinner.js';
import { MOTION_ENABLED } from './motion.js';
import { terminalSafeText } from './terminal-text.js';

export interface StatusLineProps {
  readonly busyStartedAt?: number | null;
  /** Fixed-height activity copy; replaces transcript streaming previews. */
  readonly busyLabel?: 'Working' | 'Thinking' | 'Writing';
  readonly queueCount?: number;
  /** Safety-critical badge for a special/autonomous run. */
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
  /** One global transcript-details toggle; avoids repeating Ctrl+O per block. */
  readonly detailsExpanded?: boolean;
  /** Bounded, UI-neutral status items from loaded plugins. */
  readonly chromeItems?: ReadonlyArray<ClientChromeItem>;
}

/**
 * Bottom edge of the product frame: run state on the left; model, remaining
 * context, and mode on the right. Local is intentionally implicit, while a
 * governed workspace remains explicit because it changes the safety contract.
 */
export const StatusLine: React.FC<StatusLineProps> = ({
  busyStartedAt,
  busyLabel = 'Working',
  queueCount = 0,
  modeBadge,
  modeName,
  modelName,
  contextUsed,
  contextWindow,
  governance,
  detailsExpanded = false,
  chromeItems = [],
}) => {
  const columns = useTerminalColumns();
  const tiny = columns < 58;
  const chromeFits = columns >= 128;
  const itemLimit = columns >= 140 ? 2 : 1;
  const leadingItems = chromeFits
    ? selectChromeItems(chromeItems, 'status.leading', itemLimit)
    : [];
  const trailingItems = chromeFits
    ? selectChromeItems(chromeItems, 'status.trailing', itemLimit)
    : [];
  const visibleModel = terminalSafeText(
    modelName || 'no model',
    tiny ? 10 : columns < 100 ? 18 : 28,
  );
  const visibleMode = terminalSafeText(modeName || 'default', tiny ? 9 : 18);
  const context = formatContextRemaining(contextUsed, contextWindow, columns >= 110);
  return (
    <Box justifyContent="space-between" width="100%">
      <Box>
        {modeBadge ? (
          <>
            <ModeBadgePill badge={modeBadge} />
            <Text> </Text>
          </>
        ) : null}
        {governance ? (
          <>
            <Text color={governance.stale ? Colors.busy : Colors.active} bold>
              {governance.stale ? 'MANAGED!' : 'MANAGED'}
            </Text>
            <Text dimColor>
              {` ${Glyphs.midDot} ${terminalSafeText(governance.label, tiny ? 10 : 24)}`}
            </Text>
            <Text> </Text>
          </>
        ) : null}
        <ChromeItems items={leadingItems} />
        {leadingItems.length > 0 ? <Text> </Text> : null}
        {busyStartedAt != null ? (
          <BusyMarker startedAt={busyStartedAt} label={busyLabel} />
        ) : (
          <>
            <Text color={Colors.active}>{Glyphs.filled}</Text>
            <Text bold> Ready</Text>
          </>
        )}
        {queueCount > 0 ? <Text dimColor>{`  ${Glyphs.contextUp} ${queueCount} queued`}</Text> : null}
        {!tiny ? (
          <Text dimColor>{`  ${Glyphs.midDot}  Ctrl+O ${detailsExpanded ? 'collapse' : 'details'}`}</Text>
        ) : null}
      </Box>
      <Box>
        <ChromeItems items={trailingItems} />
        {trailingItems.length > 0 ? <Text>  </Text> : null}
        <Text>{visibleModel}</Text>
        <Text dimColor>{` ${Glyphs.midDot} ${context} ${Glyphs.midDot} `}</Text>
        <Text bold>{visibleMode}</Text>
        <Text dimColor>{tiny ? ' ⇧Tab' : '  ⇧Tab'}</Text>
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

export function selectChromeItems(
  items: ReadonlyArray<ClientChromeItem>,
  slot: ClientChromeItem['slot'],
  limit: number,
): ReadonlyArray<ClientChromeItem> {
  return items
    .filter((item) => item.slot === slot)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

const ChromeItems: React.FC<{ items: ReadonlyArray<ClientChromeItem> }> = ({ items }) => (
  <>
    {items.map((item, index) => (
      <React.Fragment key={item.id}>
        {index > 0 ? <Text dimColor>{` ${Glyphs.midDot} `}</Text> : null}
        <Text
          color={
            item.tone === 'attention'
              ? Colors.busy
              : item.tone === 'positive'
                ? Colors.active
                : undefined
          }
          dimColor={item.tone === 'neutral'}
        >
          {item.label.slice(0, 24)}
        </Text>
      </React.Fragment>
    ))}
  </>
);

const ModeBadgePill: React.FC<{ badge: ModeBadge }> = ({ badge }) => (
  <Text backgroundColor={badgeBackground(badge.tone)} color="black" bold>
    {` ${badgeMarker(badge.tone)}${badge.label} RUN `}
  </Text>
);

const BusyMarker: React.FC<{
  startedAt: number;
  label: 'Working' | 'Thinking' | 'Writing';
}> = ({ startedAt, label }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!MOTION_ENABLED) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box>
      <Spinner color={Colors.busy} />
      <Text color={Colors.busy} bold>{` ${label}`}</Text>
      <Text dimColor>{`  ${formatElapsed(now - startedAt)}`}</Text>
    </Box>
  );
};

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
