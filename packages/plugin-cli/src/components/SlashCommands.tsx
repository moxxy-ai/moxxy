import React from 'react';
import { Box, Text } from 'ink';

/**
 * In-TUI slash commands. The list is shown as an autocomplete dropdown
 * when the user's input starts with `/`. Each command is a label + action
 * the InteractiveSession knows how to handle.
 */
export interface SlashCommand {
  readonly name: string;          // without leading `/`
  readonly description: string;
  /** Usage hint for args, e.g. `set <key> <value>` — shown as ghost text. */
  readonly argumentHint?: string;
  readonly aliases?: ReadonlyArray<string>;
}

/**
 * Channel-local commands that ONLY make sense in the Ink TUI — they
 * either open an overlay picker (model / loop / mcp / tools / skills /
 * agents) or mutate raw React state (yolo, queue controls). The TUI
 * merges this list with `session.commands` so the autocomplete
 * dropdown lists everything together.
 *
 * Universal commands like /info, /clear, /new, /exit, /help live in
 * `@moxxy/plugin-commands` and are inherited by every channel.
 */
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    name: 'runs',
    description: 'Continue another run or start a new one',
    aliases: ['sessions', 'switch'],
  },
  {
    name: 'model',
    description: 'Change the model connection for this run',
  },
  {
    name: 'extensions',
    description: 'Manage optional capabilities',
    aliases: ['plugins'],
  },
  { name: 'tools', description: 'List the tools the active run can call' },
  { name: 'skills', description: 'List the discovered skills' },
  { name: 'agents', description: 'Inspect subagents and their activity' },
  {
    name: 'usage',
    description: 'Token usage for this run and saved model totals',
    argumentHint: '[clear]',
  },
  {
    name: 'mode',
    description: 'Switch mode (default / goal / research)',
    argumentHint: '[mode]',
    aliases: ['loop'],
  },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'settings', description: 'Advanced runtime and presentation settings' },
  { name: 'setup', description: 'Configure an installed extension' },
  {
    name: 'channels',
    description: 'Run Slack / Telegram bots on their own runner — configure, start, stop',
  },
  {
    name: 'goal',
    description: 'Work autonomously until the objective is delivered (switches mode + auto-approves; Esc stops)',
    argumentHint: '<objective>',
  },
  {
    name: 'collab',
    description: 'Open Collaborate — start or rejoin a reviewed agent team',
    argumentHint: '[goal | command]',
  },
  {
    name: 'speak',
    description: 'Read replies aloud via the active TTS voice — bare speaks the last reply, on/off auto-speaks, stop halts',
    argumentHint: '[on|off|stop]',
    aliases: ['say'],
  },
  {
    name: 'auto-approve',
    description: 'Allow every tool call for this run without asking',
    aliases: ['yolo'],
  },
  { name: 'queue', description: 'Show queued follow-ups' },
  { name: 'clear-queue', description: 'Drop all queued follow-ups' },
];

/**
 * Match a partial slash query (e.g. `/ex`) against the command list.
 * Returns up to `limit` entries, ordered by:
 *   1. exact `name` match
 *   2. prefix match on `name`
 *   3. prefix match on an alias
 */
export function matchSlash(
  query: string,
  commands: ReadonlyArray<SlashCommand> = BUILTIN_SLASH_COMMANDS,
  limit = Number.MAX_SAFE_INTEGER,
): SlashCommand[] {
  if (!query.startsWith('/')) return [];
  const needle = query.slice(1).toLowerCase();
  if (needle === '') {
    return commands.slice(0, limit);
  }
  const exact: SlashCommand[] = [];
  const prefix: SlashCommand[] = [];
  const alias: SlashCommand[] = [];
  for (const c of commands) {
    if (c.name === needle) exact.push(c);
    else if (c.name.startsWith(needle)) prefix.push(c);
    else if (c.aliases?.some((a) => a.startsWith(needle))) alias.push(c);
  }
  return [...exact, ...prefix, ...alias].slice(0, limit);
}

/**
 * Inline autocomplete dropdown rendered above the prompt input when the
 * buffer starts with `/`. `cursor` is the index of the highlighted entry.
 *
 * The list scrolls: it shows a window of at most `maxVisible` rows that
 * follows the cursor (with `↑ N more` / `↓ N more` markers), so the full
 * command set is reachable with ↑↓ instead of being truncated.
 */
export const SlashSuggestions: React.FC<{
  matches: ReadonlyArray<SlashCommand>;
  cursor: number;
  maxVisible?: number;
}> = ({ matches, cursor, maxVisible = 8 }) => {
  if (matches.length === 0) return null;
  let start = 0;
  if (matches.length > maxVisible) {
    const half = Math.floor(maxVisible / 2);
    start = Math.min(Math.max(0, cursor - half), matches.length - maxVisible);
  }
  const end = Math.min(matches.length, start + maxVisible);
  const moreAbove = start;
  const moreBelow = matches.length - end;
  return (
    <Box flexDirection="column">
      <Text dimColor>{`  commands · ${matches.length}`}</Text>
      {moreAbove > 0 ? <Text dimColor>{`  ↑ ${moreAbove} more`}</Text> : null}
      {matches.slice(start, end).map((m, idx) => {
        const i = start + idx;
        const focused = i === cursor;
        const columns = process.stdout.columns ?? 80;
        const descriptionWidth = Math.max(18, columns - m.name.length - 10);
        const description = m.description.length > descriptionWidth
          ? `${m.description.slice(0, Math.max(1, descriptionWidth - 1))}…`
          : m.description;
        return (
          <Box key={m.name}>
            <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
            <Text {...(focused ? { bold: true } : { dimColor: true })}>/{m.name}</Text>
            <Text dimColor>{`  ${description}`}</Text>
          </Box>
        );
      })}
      {moreBelow > 0 ? <Text dimColor>{`  ↓ ${moreBelow} more`}</Text> : null}
      <Text dimColor>  ↑↓ navigate · Tab complete · Enter run · Esc close</Text>
    </Box>
  );
};
