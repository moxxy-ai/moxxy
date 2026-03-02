export const SLASH_COMMANDS = [
  { name: '/quit',   description: 'Exit the TUI',            aliases: ['/exit'] },
  { name: '/stop',   description: 'Stop the running agent',  aliases: [] },
  { name: '/clear',  description: 'Clear chat history',      aliases: [] },
  { name: '/help',   description: 'Show available commands',  aliases: [] },
  { name: '/status', description: 'Show agent status',        aliases: [] },
  { name: '/model',  description: 'Show current model info',  aliases: [] },
];

export function matchCommands(input) {
  if (!input.startsWith('/')) return [];
  const lower = input.toLowerCase();
  return SLASH_COMMANDS.filter(cmd =>
    cmd.name.startsWith(lower) ||
    cmd.aliases.some(a => a.startsWith(lower))
  );
}

export function isSlashCommand(input) {
  return input.startsWith('/');
}
