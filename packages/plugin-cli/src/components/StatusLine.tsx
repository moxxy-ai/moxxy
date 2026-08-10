import React, { useEffect, useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import type { ClientChromeItem, GovernanceInfo, ModeBadge } from '@moxxy/sdk';
import { formatElapsed } from '@moxxy/chat-model';
import { Colors, Glyphs, badgeBackground, badgeMarker } from '../theme.js';
import { Spinner } from './Spinner.js';
import { MOTION_ENABLED } from './motion.js';
import { terminalSafeText } from './terminal-text.js';

export interface StatusLineProps {
  readonly busyStartedAt?: number | null;
  readonly queueCount?: number;
  /** Safety-critical badge for a special/autonomous run. */
  readonly modeBadge?: ModeBadge | null;
  /** Current project directory; the default chrome is workspace-first. */
  readonly workspace: string;
  /** Organization policy in force, mirrored through SessionInfo. */
  readonly governance?: GovernanceInfo | null;
  /** Bounded, UI-neutral status items from loaded plugins. */
  readonly chromeItems?: ReadonlyArray<ClientChromeItem>;
}

/**
 * Product status line. It deliberately answers only three everyday questions:
 * where am I, is moxxy working, and is organization policy active? Runtime
 * architecture (provider, mode, MCP, context strategy) remains available from
 * explicit detail panels instead of occupying every frame.
 */
export const StatusLine: React.FC<StatusLineProps> = ({
  busyStartedAt,
  queueCount = 0,
  modeBadge,
  workspace,
  governance,
  chromeItems = [],
}) => {
  const columns = useTerminalColumns();
  const tiny = columns < 58;
  const chromeFits = columns >= (governance ? 120 : 72);
  const itemLimit = columns >= 140 ? 2 : 1;
  const leadingItems = chromeFits
    ? selectChromeItems(chromeItems, 'status.leading', itemLimit)
    : [];
  const trailingItems = chromeFits
    ? selectChromeItems(chromeItems, 'status.trailing', itemLimit)
    : [];
  const visibleWorkspace = tiny
    ? terminalSafeText(workspaceName(workspace), 18)
    : workspaceName(workspace);
  return (
    <Box justifyContent="space-between" width="100%">
      <Box>
        {modeBadge ? (
          <>
            <ModeBadgePill badge={modeBadge} />
            <Text> </Text>
          </>
        ) : null}
        <ChromeItems items={leadingItems} />
        {leadingItems.length > 0 ? <Text> </Text> : null}
        {busyStartedAt != null ? (
          <BusyMarker startedAt={busyStartedAt} />
        ) : (
          <>
            <Text color={Colors.active}>{Glyphs.filled}</Text>
            <Text bold> Ready</Text>
          </>
        )}
        {queueCount > 0 ? <Text dimColor>{`  ${Glyphs.contextUp} ${queueCount} queued`}</Text> : null}
      </Box>
      <Box>
        <ChromeItems items={trailingItems} />
        {trailingItems.length > 0 ? <Text>  </Text> : null}
        {governance ? <GovernanceBadge governance={governance} compact={columns < 120} /> : null}
        {governance ? <Text>  </Text> : null}
        <Text dimColor>{'◱ '}</Text>
        <Text bold>{visibleWorkspace}</Text>
      </Box>
    </Box>
  );
};

export function workspaceName(workspace: string): string {
  const trimmed = workspace.trim();
  if (!trimmed) return 'workspace';
  return terminalSafeText(path.basename(path.resolve(trimmed)) || 'workspace', 32);
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

const GovernanceBadge: React.FC<{ governance: GovernanceInfo; compact: boolean }> = ({
  governance,
  compact,
}) => (
  <Text backgroundColor={governance.stale ? Colors.busy : Colors.chrome} color="black" bold>
    {compact
      ? governance.stale
        ? ' MANAGED! '
        : ' MANAGED '
      : ` MANAGED${governance.stale ? '!' : ''} · ${terminalSafeText(governance.label, 28)} `}
  </Text>
);

const ModeBadgePill: React.FC<{ badge: ModeBadge }> = ({ badge }) => (
  <Text backgroundColor={badgeBackground(badge.tone)} color="black" bold>
    {` ${badgeMarker(badge.tone)}${badge.label} RUN `}
  </Text>
);

const BusyMarker: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!MOTION_ENABLED) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box>
      <Spinner color={Colors.busy} />
      <Text color={Colors.busy} bold>{' Working'}</Text>
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
