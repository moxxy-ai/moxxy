export const SLASH_COMMANDS = [
  { name: '/quit',         description: 'Exit the TUI',                aliases: ['/exit'] },
  { name: '/stop',         description: 'Stop the running agent',      aliases: [] },
  { name: '/new',          description: 'Reset session and start fresh', aliases: ['/reset'] },
  { name: '/clear',        description: 'Clear chat history',          aliases: [] },
  { name: '/help',         description: 'Show available commands',     aliases: [] },
  { name: '/status',       description: 'Show agent status',           aliases: [] },
  { name: '/model',        description: 'Open model picker',           aliases: [] },
  { name: '/vault',        description: 'Open vault actions',          aliases: ['/vault delete'] },
  { name: '/mcp',          description: 'Open MCP actions',            aliases: [] },
  { name: '/template',     description: 'Open template actions',       aliases: [] },
];

export function matchCommands(input) {
  if (!input.startsWith('/')) return [];
  const lower = input.toLowerCase();
  return SLASH_COMMANDS.filter(cmd =>
    cmd.name.startsWith(lower) ||
    lower.startsWith(cmd.name) ||
    cmd.aliases.some(a => a.startsWith(lower) || lower.startsWith(a))
  );
}

export function isSlashCommand(input) {
  return input.startsWith('/');
}
