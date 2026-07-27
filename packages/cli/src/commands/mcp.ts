// Subpath, not the barrel: the barrel loads the MCP SDK (and its ~200 KB ajv
// dependency) for a command that only reads and edits ~/.moxxy/mcp.json.
import {
  mcpConfigPath,
  readMcpConfig,
  removeServerFromConfig,
  setServerDisabled,
} from '@moxxy/plugin-mcp/config-io';
import type { ParsedArgv } from '../argv.js';
import { helpRequested } from '../argv-helpers.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy mcp',
  tagline: 'manage Model Context Protocol servers',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'list every server in ~/.moxxy/mcp.json'],
        ['enable <name>', 're-enable a previously-disabled server'],
        ['disable <name>', 'disable a server without removing it'],
        ['remove <name>', 'drop a server from the catalog'],
        ['path', 'print the catalog file path'],
      ],
    },
  ],
  footer: [
    'Add new servers from a moxxy chat session — the model uses mcp_add_server',
    'to register them (tests connection first, caches tool descriptors). This',
    'CLI is for enable / disable / remove on existing entries.',
  ],
});

export async function runMcpCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';

  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }

  switch (sub) {
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;

    case 'path':
      process.stdout.write(mcpConfigPath() + '\n');
      return 0;

    case 'list': {
      const cfg = await readMcpConfig();
      if (cfg.servers.length === 0) {
        process.stdout.write(colors.dim('(no MCP servers registered)\n'));
        return 0;
      }
      const nameCol = Math.max(8, ...cfg.servers.map((s) => s.name.length));
      for (const s of cfg.servers) {
        const status = s.disabled ? 'disabled' : 'enabled';
        const conn = s.kind === undefined || s.kind === 'stdio'
          ? `stdio: ${(s as { command: string }).command}`
          : `${s.kind}: ${(s as { url: string }).url}`;
        const toolCount = s.cachedTools?.length ?? 0;
        process.stdout.write(
          `${colors.bold(s.name.padEnd(nameCol))}  ${colors.dim(status)}\n` +
            `${' '.repeat(nameCol + 2)}${colors.dim(`${toolCount} tool${toolCount === 1 ? '' : 's'} · ${conn}`)}\n`,
        );
      }
      return 0;
    }

    case 'enable':
    case 'disable': {
      const name = argv.positional[1];
      if (!name) {
        process.stderr.write(`${colors.red(`missing server name`)}\n  usage: moxxy mcp ${sub} <name>\n`);
        return 2;
      }
      const updated = await setServerDisabled(name, sub === 'disable');
      if (!updated) {
        process.stderr.write(`${colors.red(`no MCP server named "${name}"`)}\n`);
        return 1;
      }
      const verb = sub === 'disable' ? 'disabled' : 'enabled';
      process.stdout.write(
        `${colors.bold(verb)}  ${name}\n` +
          `         ${colors.dim('restart any running TUI to pick up the change')}\n`,
      );
      return 0;
    }

    case 'remove': {
      const name = argv.positional[1];
      if (!name) {
        process.stderr.write(`${colors.red(`missing server name`)}\n  usage: moxxy mcp remove <name>\n`);
        return 2;
      }
      const removed = await removeServerFromConfig(name);
      if (!removed) {
        process.stderr.write(`${colors.red(`no MCP server named "${name}"`)}\n`);
        return 1;
      }
      process.stdout.write(`${colors.bold('removed')}  ${name}  ${colors.dim('from ' + mcpConfigPath())}\n`);
      return 0;
    }

    default:
      process.stderr.write(`${colors.red(`unknown subcommand: ${sub}`)}\n${HELP}`);
      return 2;
  }
}
