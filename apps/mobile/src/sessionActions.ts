export interface MobileSessionActionRow {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly tone: 'neutral' | 'attention' | 'destructive';
  readonly args: ReadonlyArray<MobileSessionActionArg>;
  readonly aliases?: ReadonlyArray<string>;
}

export interface MobileSessionActionArg {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly multiline?: boolean;
}

export interface MobileCommandInfo {
  readonly name: string;
  readonly description?: string;
  readonly aliases?: ReadonlyArray<string>;
}

interface ActionMetadata {
  readonly label?: string;
  readonly description?: string;
  readonly tone?: MobileSessionActionRow['tone'];
  readonly subcommand?: string;
  readonly args?: ReadonlyArray<MobileSessionActionArg>;
}

const FALLBACK_COMMANDS: ReadonlyArray<MobileCommandInfo> = [
  { name: 'info' },
  { name: 'clear' },
  { name: 'new' },
  { name: 'compact' },
  { name: 'help' },
];

const ACTION_METADATA: Record<string, ActionMetadata> = {
  info: {
    label: 'Info',
    description: 'Show provider, model, mode, plugin and skill counts.',
  },
  clear: {
    label: 'Clear',
    description: 'Clear the chat scrollback while keeping the session log replayable.',
    tone: 'destructive',
  },
  new: {
    label: 'New',
    description: 'Start a fresh session and drop the current conversation context.',
  },
  compact: {
    label: 'Compact',
    description: 'Summarize older turns to free the model context window.',
    tone: 'attention',
  },
  help: {
    label: 'Help',
    description: 'List every action available in this channel.',
  },
  vault: {
    label: 'Vault',
    subcommand: 'set',
    args: [
      {
        id: 'key',
        label: 'Vault key',
        placeholder: 'OPENAI_API_KEY',
      },
      {
        id: 'value',
        label: 'Value',
        placeholder: 'sk-...',
      },
    ],
  },
};

export function buildMobileSessionActionRows(
  commands: ReadonlyArray<MobileCommandInfo> = FALLBACK_COMMANDS,
): MobileSessionActionRow[] {
  return commands.map((command) => {
    const metadata = ACTION_METADATA[command.name] ?? {};
    return {
      id: command.name,
      name: command.name,
      label: metadata.label ?? humanizeSessionActionName(command.name),
      description: metadata.description ?? command.description ?? 'No description',
      tone: metadata.tone ?? 'neutral',
      args: [...(metadata.args ?? [])],
      aliases: command.aliases ? [...command.aliases] : undefined,
    };
  });
}

export function subcommandForSessionAction(commandName: string): string | undefined {
  return ACTION_METADATA[commandName]?.subcommand;
}

export function actionMatchesFilter(action: MobileSessionActionRow, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return (
    action.name.toLowerCase().includes(q) ||
    action.label.toLowerCase().includes(q) ||
    action.description.toLowerCase().includes(q) ||
    action.aliases?.some((alias) => alias.toLowerCase().includes(q)) === true
  );
}

export function encodeSessionCommandArgs(values: ReadonlyArray<string>): string {
  return values
    .map((value) => {
      const trimmed = value.trim();
      if (!trimmed) return '';
      return /\s|"/.test(trimmed) ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;
    })
    .filter(Boolean)
    .join(' ');
}

function humanizeSessionActionName(name: string): string {
  return name
    .split(' ')
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}
