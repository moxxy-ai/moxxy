export const SLASH_COMMANDS = [
  { name: '/quit',         description: 'Exit the TUI',                aliases: ['/exit'] },
  { name: '/stop',         description: 'Stop the running agent',      aliases: [] },
  { name: '/new',          description: 'Reset session and start fresh', aliases: ['/reset'] },
  { name: '/clear',        description: 'Clear chat history',          aliases: [] },
  { name: '/help',         description: 'Show available commands',     aliases: [] },
  { name: '/status',       description: 'Show agent status',           aliases: [] },
  { name: '/model',        description: 'Open model picker',           aliases: [] },
  { name: '/vault list',   description: 'List vault secrets',          aliases: [] },
  { name: '/vault set',    description: 'Set a vault secret',          aliases: [] },
  { name: '/vault remove', description: 'Remove a vault secret',       aliases: ['/vault delete'] },
  { name: '/mcp list',     description: 'List MCP servers and tools',   aliases: [] },
  { name: '/mcp add',      description: 'Add an MCP server',           aliases: [] },
  { name: '/mcp remove',   description: 'Remove an MCP server',        aliases: [] },
  { name: '/mcp test',     description: 'Test MCP server connection',   aliases: [] },
  { name: '/template list',   description: 'List available templates',    aliases: [] },
  { name: '/template assign',description: 'Assign a template to agent', aliases: [] },
  { name: '/template clear', description: 'Clear agent template',       aliases: [] },
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
