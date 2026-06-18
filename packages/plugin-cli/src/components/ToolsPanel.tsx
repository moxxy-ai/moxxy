import React from 'react';
import { Box, Text } from 'ink';
import type { ToolDef } from '@moxxy/sdk';
import { truncate, oneLine } from '@moxxy/chat-model';
import { Colors } from '../theme.js';
import { Modal, type ModalTab } from './Modal.js';
import { useScrollableList } from './useScrollableList.js';

export interface ToolsPanelProps {
  readonly tools: ReadonlyArray<ToolDef>;
  /** Called when the user presses Esc inside the modal. */
  readonly onClose?: () => void;
}

const NAME_COL = 30;
const BADGE_COL = 9;
const WINDOW = 15;

type TabId = 'all' | 'auto' | 'prompt' | 'deny';

/**
 * Scrollable `/tools` modal. ↑↓ / PgUp / PgDn / g / G navigate the
 * list; Esc closes (owned by Modal). Tabs let the user filter by
 * permission action so the table stays scannable as the tool count
 * grows past one screen.
 */
export const ToolsPanel: React.FC<ToolsPanelProps> = ({ tools, onClose }) => {
  const sorted = React.useMemo(
    () => [...tools].sort((a, b) => a.name.localeCompare(b.name)),
    [tools],
  );
  const counts = React.useMemo(() => {
    let auto = 0;
    let prompt = 0;
    let deny = 0;
    for (const t of sorted) {
      const action = t.permission?.action ?? 'allow';
      if (action === 'allow') auto += 1;
      else if (action === 'prompt') prompt += 1;
      else deny += 1;
    }
    return { auto, prompt, deny };
  }, [sorted]);

  const [activeTab, setActiveTab] = React.useState<TabId>('all');
  const filtered = React.useMemo(
    () => sorted.filter((t) => matchesTab(t, activeTab)),
    [sorted, activeTab],
  );

  const scroll = useScrollableList({
    total: filtered.length,
    windowSize: WINDOW,
  });

  const tabs: ModalTab[] = [
    { id: 'all', label: `All (${sorted.length})` },
    { id: 'auto', label: `Auto (${counts.auto})` },
    { id: 'prompt', label: `Prompt (${counts.prompt})` },
    { id: 'deny', label: `Deny (${counts.deny})` },
  ];

  if (sorted.length === 0) {
    return (
      <Modal
        title="Tools"
        subtitle="none registered"
        {...(onClose ? { onClose } : {})}
      >
        <Text dimColor>(no tools registered)</Text>
      </Modal>
    );
  }

  const slice = filtered.slice(scroll.visible.start, scroll.visible.end);
  const subtitle =
    filtered.length === 0
      ? `0 of ${sorted.length}  ·  no tools in this filter`
      : `${scroll.cursor + 1} of ${filtered.length}  ·  ${filtered.length} shown`;
  const hints = '↑↓ navigate · PgUp/PgDn fast · g/G top/bottom';

  return (
    <Modal
      title="Tools"
      subtitle={subtitle}
      hints={hints}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      {...(onClose ? { onClose } : {})}
    >
      {filtered.length === 0 ? (
        <Text dimColor>(no tools match this filter)</Text>
      ) : null}
      {scroll.canScrollUp ? (
        <Text dimColor>{`  ↑ ${scroll.offset} more above`}</Text>
      ) : null}
      {slice.map((t, i) => {
        const absoluteIndex = scroll.visible.start + i;
        const focused = absoluteIndex === scroll.cursor;
        return <ToolRow key={t.name} tool={t} focused={focused} />;
      })}
      {scroll.canScrollDown ? (
        <Text dimColor>{`  ↓ ${filtered.length - scroll.visible.end} more below`}</Text>
      ) : null}
    </Modal>
  );
};

function matchesTab(tool: ToolDef, tab: TabId): boolean {
  if (tab === 'all') return true;
  const action = tool.permission?.action ?? 'allow';
  if (tab === 'auto') return action === 'allow';
  if (tab === 'prompt') return action === 'prompt';
  return action === 'deny';
}

const ToolRow: React.FC<{ tool: ToolDef; focused: boolean }> = ({ tool, focused }) => {
  const perm = tool.permission?.action ?? 'allow';
  const termWidth = process.stdout.columns ?? 80;
  const descWidth = Math.max(20, termWidth - NAME_COL - BADGE_COL - 12);
  const desc = oneLine(tool.description ?? '');
  return (
    <Box>
      <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
      <Box width={NAME_COL}>
        <Text bold>{truncate(tool.name, NAME_COL - 2)}</Text>
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
