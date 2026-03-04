export const SLASH_COMMANDS = [
  { name: '/quit',         description: 'Exit the TUI',                aliases: ['/exit'] },
  { name: '/stop',         description: 'Stop the running agent',      aliases: [] },
  { name: '/new',          description: 'Reset session and start fresh', aliases: ['/reset'] },
  { name: '/clear',        description: 'Clear chat history',          aliases: [] },
  { name: '/help',         description: 'Show available commands',     aliases: [] },
  { name: '/status',       description: 'Show agent status',           aliases: [] },
  { name: '/model',        description: 'Show current model info',     aliases: [] },
  { name: '/model list',   description: 'List available models',       aliases: [] },
  { name: '/model switch', description: 'Switch provider/model',       aliases: [] },
  { name: '/vault list',   description: 'List vault secrets',          aliases: [] },
  { name: '/vault set',    description: 'Set a vault secret',          aliases: [] },
  { name: '/vault remove', description: 'Remove a vault secret',       aliases: ['/vault delete'] },
  { name: '/select',       description: 'Toggle select mode (Ctrl+Y)', aliases: ['/copy'] },
  { name: '/tab new',      description: 'Open a new agent tab',        aliases: [] },
  { name: '/tab close',    description: 'Close current tab',           aliases: ['/close'] },
  { name: '/tab list',     description: 'List open tabs',              aliases: [] },
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
