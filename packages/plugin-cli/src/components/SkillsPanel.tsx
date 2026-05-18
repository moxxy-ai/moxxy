import React from 'react';
import { Box, Text } from 'ink';
import type { Skill, SkillScope } from '@moxxy/sdk';
import { Modal } from './Modal.js';
import { useScrollableList } from './useScrollableList.js';

export interface McpServerSummary {
  readonly name: string;
  readonly toolCount: number;
  readonly toolNames: ReadonlyArray<string>;
}

export interface SkillsPanelProps {
  readonly skills: ReadonlyArray<Skill>;
  /**
   * Optional summary of currently-registered MCP servers. Each entry
   * adds a row to the scrollable list with `scope=mcp`.
   */
  readonly mcpServers?: ReadonlyArray<McpServerSummary>;
  /** Called when the user presses Esc inside the modal. */
  readonly onClose?: () => void;
}

const NAME_COL = 28;
const SCOPE_COL = 10;
const WINDOW = 15;
const ORDER: ReadonlyArray<SkillScope> = ['user', 'project', 'builtin', 'plugin'];

interface Row {
  readonly key: string;
  readonly name: string;
  readonly scope: string;
  readonly description: string;
}

/**
 * Scrollable `/skills` modal. ↑↓ / PgUp / PgDn / g / G navigate the
 * list; Esc closes. Skills group by scope; MCP servers append to the
 * end with `scope=mcp`. Each row is one line so 15 rows fit in the
 * default window without overflowing the modal.
 */
export const SkillsPanel: React.FC<SkillsPanelProps> = ({ skills, mcpServers, onClose }) => {
  const hasMcp = mcpServers && mcpServers.length > 0;
  const rows: Row[] = [];
  for (const s of orderByScope(skills)) {
    rows.push({
      key: `skill:${s.id}`,
      name: s.frontmatter.name,
      scope: s.scope,
      description: s.frontmatter.description ?? '',
    });
  }
  if (hasMcp) {
    for (const srv of mcpServers!) {
      rows.push({
        key: `mcp:${srv.name}`,
        name: srv.name,
        scope: 'mcp',
        description: `${srv.toolCount} tool${srv.toolCount === 1 ? '' : 's'} · mcp__${srv.name}__*`,
      });
    }
  }

  const scroll = useScrollableList({
    total: rows.length,
    windowSize: WINDOW,
    ...(onClose ? { onClose } : {}),
  });

  const subtitle = subtitleFor(skills.length, mcpServers?.length ?? 0, scroll);
  const hints = '↑↓ navigate · PgUp/PgDn fast · g/G top/bottom · Esc close';
  const slice = rows.slice(scroll.visible.start, scroll.visible.end);
  const termWidth = process.stdout.columns ?? 80;
  const descWidth = Math.max(20, termWidth - NAME_COL - SCOPE_COL - 12);

  return (
    <Modal title="Skills" subtitle={subtitle} hints={hints}>
      {rows.length === 0 ? <Text dimColor>(no skills discovered)</Text> : null}
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
              <Text bold>{truncate(row.name, NAME_COL - 1)}</Text>
            </Box>
            <Box width={SCOPE_COL}>
              <Text dimColor>{row.scope}</Text>
            </Box>
            <Box width={descWidth}>
              <Text dimColor wrap="truncate">{oneLine(row.description)}</Text>
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
  skillCount: number,
  mcpCount: number,
  scroll: ReturnType<typeof useScrollableList>,
): string {
  if (scroll.total === 0) return 'none discovered';
  const pos = `${scroll.cursor + 1} of ${scroll.total}`;
  const composition =
    `${skillCount} skill${skillCount === 1 ? '' : 's'}` +
    (mcpCount > 0 ? ` · ${mcpCount} MCP server${mcpCount === 1 ? '' : 's'}` : '');
  return `${pos}  ·  ${composition}`;
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

function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/  +/g, ' ').trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
