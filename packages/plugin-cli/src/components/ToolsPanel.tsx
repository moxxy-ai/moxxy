import React from 'react';
import { Box, Text } from 'ink';
import type { ToolDef } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';
import { useScrollableList } from './useScrollableList.js';

export interface ToolsPanelProps {
  readonly tools: ReadonlyArray<ToolDef>;
  /** Called when the user presses Esc inside the modal. */
  readonly onClose?: () => void;
}

const NAME_COL = 30;
const BADGE_COL = 9;
const WINDOW = 15;

/**
 * Scrollable `/tools` modal. ↑↓ / PgUp / PgDn / g / G navigate the
 * list; Esc closes. Each row is one line so the visible window stays
 * predictable regardless of how long any single description is.
 */
export const ToolsPanel: React.FC<ToolsPanelProps> = ({ tools, onClose }) => {
  const sorted = React.useMemo(
    () => [...tools].sort((a, b) => a.name.localeCompare(b.name)),
    [tools],
  );
  const scroll = useScrollableList({
    total: sorted.length,
    windowSize: WINDOW,
    ...(onClose ? { onClose } : {}),
  });

  if (sorted.length === 0) {
    return (
      <Modal title="Tools" subtitle="none registered" hints="Esc close">
        <Text dimColor>(no tools registered)</Text>
      </Modal>
    );
  }

  const slice = sorted.slice(scroll.visible.start, scroll.visible.end);
  const subtitle = `${scroll.cursor + 1} of ${sorted.length}  ·  ${sorted.length} registered`;
  const hints = '↑↓ navigate · PgUp/PgDn fast · g/G top/bottom · Esc close';

  return (
    <Modal title="Tools" subtitle={subtitle} hints={hints}>
      {scroll.canScrollUp ? (
        <Text dimColor>{`  ↑ ${scroll.offset} more above`}</Text>
      ) : null}
      {slice.map((t, i) => {
        const absoluteIndex = scroll.visible.start + i;
        const focused = absoluteIndex === scroll.cursor;
        return <ToolRow key={t.name} tool={t} focused={focused} />;
      })}
      {scroll.canScrollDown ? (
        <Text dimColor>{`  ↓ ${sorted.length - scroll.visible.end} more below`}</Text>
      ) : null}
    </Modal>
  );
};

const ToolRow: React.FC<{ tool: ToolDef; focused: boolean }> = ({ tool, focused }) => {
  const perm = tool.permission?.action ?? 'allow';
  const termWidth = process.stdout.columns ?? 80;
  const descWidth = Math.max(20, termWidth - NAME_COL - BADGE_COL - 12);
  const desc = oneLine(tool.description ?? '');
  return (
    <Box>
      <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
      <Box width={NAME_COL}>
        <Text bold>{truncate(tool.name, NAME_COL - 1)}</Text>
      </Box>
      <Box width={BADGE_COL}>
        <PermissionBadge action={perm} />
      </Box>
      <Box width={descWidth}>
        <Text dimColor wrap="truncate">{desc}</Text>
      </Box>
    </Box>
  );
};

const PermissionBadge: React.FC<{ action: 'allow' | 'deny' | 'prompt' }> = ({ action }) => {
  if (action === 'allow') return <Text dimColor>[auto] </Text>;
  if (action === 'deny') return <Text color={Colors.danger}>[deny] </Text>;
  return <Text color={Colors.busy}>[prompt]</Text>;
};

function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/  +/g, ' ').trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
