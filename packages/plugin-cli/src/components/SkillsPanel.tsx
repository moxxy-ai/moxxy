import React from 'react';
import { Box, Text } from 'ink';
import type { Skill, SkillScope } from '@moxxy/sdk';
import { truncate, oneLine } from '@moxxy/chat-model';
import { Modal, type ModalTab } from './Modal.js';
import { useScrollableList } from './useScrollableList.js';

export interface McpServerSummary {
  readonly name: string;
  readonly toolCount: number;
  readonly toolNames: ReadonlyArray<string>;
}

export interface SkillsPanelProps {
  readonly skills: ReadonlyArray<Skill>;
  /**
   * Optional summary of currently-registered MCP servers. When present,
   * the panel renders a second tab dedicated to them; without it, the
   * tab strip stays hidden.
   */
  readonly mcpServers?: ReadonlyArray<McpServerSummary>;
  /**
   * Optional per-skill-name cross-session invocation counts (loaded from
   * `~/.moxxy/skills/.meta/usage.json`). A `×N` badge is shown for any skill
   * with a positive count; absent/zero entries render nothing. Best-effort:
   * omitting this prop just hides the badges.
   */
  readonly usage?: Readonly<Record<string, number>>;
  /** Called when the user presses Esc inside the modal. */
  readonly onClose?: () => void;
}

const NAME_COL = 28;
const SCOPE_COL = 10;
const USED_COL = 6;
const WINDOW = 15;
const ORDER: ReadonlyArray<SkillScope> = ['user', 'project', 'builtin', 'plugin'];

type TabId = 'skills' | 'mcp';

interface Row {
  readonly key: string;
  readonly name: string;
  readonly scope: string;
  readonly description: string;
  /** Cross-session invocation count; a `×N` badge when > 0, hidden otherwise. */
  readonly used?: number;
}

/**
 * Build the ordered skill rows for the panel, threading in cross-session
 * invocation counts keyed by skill name. Pure and exported so it can be
 * unit-tested without an Ink render harness.
 */
export function buildSkillRows(
  skills: ReadonlyArray<Skill>,
  usage?: Readonly<Record<string, number>>,
): Row[] {
  const out: Row[] = [];
  for (const s of orderByScope(skills)) {
    const count = usage?.[s.frontmatter.name];
    out.push({
      key: `skill:${s.id}`,
      name: s.frontmatter.name,
      scope: s.scope,
      description: s.frontmatter.description ?? '',
      ...(count && count > 0 ? { used: count } : {}),
    });
  }
  return out;
}

/**
 * Scrollable `/skills` modal. ↑↓ / PgUp / PgDn / g / G navigate the
 * list; Esc closes (owned by Modal). When MCP servers are present, a
 * tab strip lets the user flip between skills and MCP servers with ←/→.
 */
export const SkillsPanel: React.FC<SkillsPanelProps> = ({ skills, mcpServers, usage, onClose }) => {
  const hasMcp = !!mcpServers && mcpServers.length > 0;
  const [activeTab, setActiveTab] = React.useState<TabId>('skills');

  const skillRows: Row[] = React.useMemo(() => buildSkillRows(skills, usage), [skills, usage]);

  const mcpRows: Row[] = React.useMemo(() => {
    if (!hasMcp) return [];
    return mcpServers!.map((srv) => ({
      key: `mcp:${srv.name}`,
      name: srv.name,
      scope: 'mcp',
      description: `${srv.toolCount} tool${srv.toolCount === 1 ? '' : 's'} · mcp__${srv.name}__*`,
    }));
  }, [hasMcp, mcpServers]);

  const rows = activeTab === 'mcp' ? mcpRows : skillRows;

  const scroll = useScrollableList({
    total: rows.length,
    windowSize: WINDOW,
  });

  const tabs: ModalTab[] | undefined = hasMcp
    ? [
        { id: 'skills', label: `Skills (${skillRows.length})` },
        { id: 'mcp', label: `MCP (${mcpRows.length})` },
      ]
    : undefined;

  const subtitle = subtitleFor(activeTab, rows.length, scroll);
  const hints = '↑↓ navigate · PgUp/PgDn fast · g/G top/bottom';
  const slice = rows.slice(scroll.visible.start, scroll.visible.end);
  const termWidth = process.stdout.columns ?? 80;
  const descWidth = Math.max(20, termWidth - NAME_COL - SCOPE_COL - USED_COL - 12);

  return (
    <Modal
      title="Skills"
      subtitle={subtitle}
      hints={hints}
      {...(tabs ? { tabs, activeTabId: activeTab, onTabChange: (id) => setActiveTab(id as TabId) } : {})}
      {...(onClose ? { onClose } : {})}
    >
      {rows.length === 0 ? (
        <Text dimColor>{activeTab === 'mcp' ? '(no MCP servers attached)' : '(no skills discovered)'}</Text>
      ) : null}
      {scroll.canScrollUp ? (
        <Text dimColor>{`  ↑ ${scroll.offset} more above`}</Text>
      ) : null}
      {slice.map((row, i) => {
        const absoluteIndex = scroll.visible.start + i;
        const focused = absoluteIndex === scroll.cursor;
        return (
          <Box key={row.key}>
            <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
            <Box width={NAME_COL}>
              <Text bold>{truncate(row.name, NAME_COL - 2)}</Text>
            </Box>
            <Box width={SCOPE_COL}>
              <Text dimColor>{row.scope}</Text>
            </Box>
            <Box width={descWidth}>
              <Text dimColor wrap="truncate">{oneLine(row.description)}</Text>
            </Box>
            <Box width={USED_COL} justifyContent="flex-end">
              {row.used ? <Text dimColor>{`×${row.used}`}</Text> : null}
            </Box>
          </Box>
        );
      })}
      {scroll.canScrollDown ? (
        <Text dimColor>{`  ↓ ${rows.length - scroll.visible.end} more below`}</Text>
      ) : null}
    </Modal>
  );
};

function subtitleFor(
  tab: TabId,
  total: number,
  scroll: ReturnType<typeof useScrollableList>,
): string {
  if (total === 0) return tab === 'mcp' ? 'none attached' : 'none discovered';
  const pos = `${scroll.cursor + 1} of ${total}`;
  const noun = tab === 'mcp' ? `MCP server${total === 1 ? '' : 's'}` : `skill${total === 1 ? '' : 's'}`;
  return `${pos}  ·  ${total} ${noun}`;
}

function orderByScope(skills: ReadonlyArray<Skill>): Skill[] {
  const buckets = new Map<SkillScope, Skill[]>();
  for (const s of skills) {
    const list = buckets.get(s.scope) ?? [];
    list.push(s);
    buckets.set(s.scope, list);
  }
  const out: Skill[] = [];
  for (const scope of ORDER) {
    const list = buckets.get(scope);
    if (!list) continue;
    list.sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));
    out.push(...list);
  }
  return out;
}
