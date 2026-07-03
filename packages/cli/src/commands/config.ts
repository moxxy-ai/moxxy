import { loadConfig, setConfigValue, type ConfigScope } from '@moxxy/config';
import type { ParsedArgv } from '../argv.js';
import { stringFlag } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy config',
  tagline: 'read and edit the moxxy config from the command line',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['show', 'print the MERGED config (user + project) as JSON'],
        ['get <path>', 'print the merged value at a dot-path (JSON)'],
        ['set <path> <value>', 'set a value (JSON-parsed; bare words stay strings)'],
        ['path', 'print which config files are in effect'],
      ],
    },
    {
      title: 'FLAGS',
      rows: [
        ['--scope user|project', 'where `set` writes (default: user — ~/.moxxy/config.yaml)'],
      ],
    },
    {
      title: 'EXAMPLES',
      rows: [
        ['moxxy config get plugins.mode.default', ''],
        ['moxxy config set context.reasoning true', ''],
        ['moxxy config set tui.theme mono', ''],
      ],
    },
  ],
});

/** Mirror of the config_set tool's value parsing: JSON when it parses,
 *  bare string otherwise — so `set tui.theme mono` needs no quoting. */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function valueAtPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotPath.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export async function runConfigCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0];
  const scope = (stringFlag(argv, 'scope') ?? 'user') as ConfigScope;
  if (scope !== 'user' && scope !== 'project') {
    printError(`invalid --scope: ${scope} (use user|project)`);
    return 2;
  }

  switch (sub) {
    case 'show': {
      const { config } = await loadConfig({ cwd: process.cwd() });
      process.stdout.write(JSON.stringify(config, null, 2) + '\n');
      return 0;
    }
    case 'get': {
      const dotPath = argv.positional[1];
      if (!dotPath) {
        printError('config get requires a dot-path (e.g. plugins.mode.default)');
        return 2;
      }
      const { config } = await loadConfig({ cwd: process.cwd() });
      const value = valueAtPath(config, dotPath);
      if (value === undefined) {
        process.stdout.write(colors.dim('(unset)') + '\n');
        return 1;
      }
      process.stdout.write(JSON.stringify(value, null, 2) + '\n');
      return 0;
    }
    case 'set': {
      const dotPath = argv.positional[1];
      const raw = argv.positional[2];
      if (!dotPath || raw === undefined) {
        printError('config set requires a dot-path and a value');
        return 2;
      }
      try {
        const res = await setConfigValue({
          scope,
          cwd: process.cwd(),
          path: dotPath,
          value: parseValue(raw),
        });
        process.stdout.write(
          `${colors.bold('✓')} ${dotPath} set in ${res.path}\n` +
            colors.dim('running sessions pick it up via /settings, config_reload, or restart\n'),
        );
        return 0;
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }
    case 'path': {
      const { sources } = await loadConfig({ cwd: process.cwd() });
      if (sources.length === 0) {
        process.stdout.write(colors.dim('no config files found (run `moxxy init`)\n'));
        return 0;
      }
      const col = Math.max(...sources.map((s) => s.scope.length));
      for (const s of sources) {
        process.stdout.write(`${colors.bold(s.scope.padEnd(col))}  ${s.path}\n`);
      }
      return 0;
    }
    default:
      process.stdout.write(HELP);
      return sub ? 2 : 0;
  }
}
