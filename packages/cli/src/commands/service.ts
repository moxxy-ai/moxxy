import type { ParsedArgv } from '../argv.js';
import { colors } from '../colors.js';
import { helpRequested, stringFlag } from '../argv-helpers.js';
import { formatHelp } from './help-format.js';
import {
  getServiceStatus,
  installAndStartService,
  readServiceLog,
  serviceLogPath,
  servicePlatform,
  startInstalledService,
  stopAndUninstallService,
  stopRunningService,
  type ServiceSpec,
  type ServiceStatus,
} from './service/index.js';

/**
 * `moxxy service` — install moxxy bits as a launchd / systemd --user
 * unit so they run in the background across logout and restart.
 *
 * Currently shipped catalog:
 *   - telegram  → `moxxy telegram --no-wizard`     (bot stays online for the paired chat)
 *   - http      → `moxxy channels http`            (HTTP channel listener)
 *   - scheduler → `moxxy schedule daemon`          (cron / one-shot prompt firing)
 *
 * The user pairs / configures the channel interactively first (e.g.
 * `moxxy telegram` walks through token + pair). Then they run
 * `moxxy service install telegram` to flip that channel into a
 * background unit. From then on the bot answers messages whether or
 * not their terminal is open.
 */

const CATALOG: ReadonlyArray<ServiceSpec> = [
  {
    id: 'serve',
    description:
      'moxxy serve --all — every registered channel + scheduler + webhooks in ONE process. ' +
      'Use this when you want a single background unit instead of separate per-channel units. ' +
      '(For a bare runner unit — no channels, clients attach — use `moxxy serve --background`.)',
    // `--all` matches the description above: without it a serve unit starts
    // NO channels (bare runner) and a paired bot would stay offline.
    execArgs: ['serve', '--all'],
  },
  {
    id: 'telegram',
    description: 'moxxy telegram channel — keeps the paired bot online in the background',
    execArgs: ['telegram', '--no-wizard'],
  },
  {
    id: 'http',
    description: 'moxxy HTTP channel — serves /v1/turn for remote requests',
    execArgs: ['channels', 'http'],
  },
  {
    id: 'scheduler',
    description: 'moxxy scheduler — fires time-driven prompts',
    execArgs: ['schedule', 'daemon'],
  },
];

const HELP = formatHelp({
  title: 'moxxy service',
  tagline: 'run moxxy channels + the scheduler as a background OS unit',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'show every known service and whether it\'s installed / running'],
        ['install <name>', 'install + start a service (creates a launchd / systemd unit)'],
        ['uninstall <name>', 'stop + remove the unit file'],
        ['start <name>', 'start an already-installed service'],
        ['stop <name>', 'stop a running service (does not uninstall)'],
        ['restart <name>', 'stop then start'],
        ['status [<name>]', 'one-line summary for one service, or all if omitted'],
        ['logs <name> [--lines N]', 'tail the service log (default 40 lines)'],
        ['path <name>', 'print the unit file path'],
      ],
    },
    {
      title: 'CATALOG',
      rows: CATALOG.map(
        (s) =>
          [
            s.id,
            `${s.description}  ${colors.dim('—')}  ${s.execArgs.join(' ')}` as string,
          ] as [string, string],
      ),
    },
  ],
  footer: [
    'macOS  → installs a launchd LaunchAgent at ~/Library/LaunchAgents/com.moxxy.<id>.plist',
    'Linux  → installs a systemd --user unit at ~/.config/systemd/user/moxxy-<id>.service',
    '         (run `loginctl enable-linger <user>` once to survive logout)',
    '',
    'Logs land in ~/.moxxy/services/<id>.log. Configure the channel interactively first',
    '(e.g. `moxxy telegram` to set a token + pair a chat) before installing it as a service.',
  ],
});

function findSpec(name: string): ServiceSpec | null {
  return CATALOG.find((s) => s.id === name) ?? null;
}

export async function runServiceCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  if (servicePlatform() === 'unsupported') {
    process.stderr.write(
      colors.red(`moxxy service: unsupported platform (${process.platform})`) +
        '\n' +
        colors.dim('Only macOS (launchd) and Linux (systemd --user) are wired up.\n'),
    );
    return 1;
  }

  if (sub === 'list') return await runList();
  if (sub === 'status') return await runStatus(argv);

  const name = argv.positional[1];
  if (!name) {
    process.stderr.write(`${colors.red(`missing service name`)}\n  usage: moxxy service ${sub} <name>\n`);
    return 2;
  }
  const spec = findSpec(name);
  if (!spec) {
    process.stderr.write(
      `${colors.red(`unknown service: ${name}`)}\n` +
        colors.dim('  known: ' + CATALOG.map((s) => s.id).join(', ')) +
        '\n',
    );
    return 2;
  }

  switch (sub) {
    case 'install':
      return await runInstall(spec);
    case 'uninstall':
      return await runUninstall(spec);
    case 'start':
      return await runStart(spec);
    case 'stop':
      return await runStop(spec);
    case 'restart':
      return await runRestart(spec);
    case 'logs':
      return await runLogs(spec, argv);
    case 'path':
      return await runPath(spec);
    default:
      process.stderr.write(`${colors.red(`unknown service subcommand: ${sub}`)}\n${HELP}`);
      return 2;
  }
}

async function runList(): Promise<number> {
  const statuses = await Promise.all(CATALOG.map((s) => getServiceStatus(s)));
  const nameCol = Math.max(8, ...CATALOG.map((s) => s.id.length));
  // Two-row entry per service: bold name + state badge on row 1, dim
  // description on row 2. Mirrors `moxxy channels` exactly.
  for (let i = 0; i < CATALOG.length; i += 1) {
    const spec = CATALOG[i]!;
    const status = statuses[i]!;
    const badge = stateBadge(status);
    process.stdout.write(`${colors.bold(spec.id.padEnd(nameCol))}  ${badge}\n`);
    process.stdout.write(`${' '.repeat(nameCol + 2)}${colors.dim(spec.description)}\n`);
    process.stdout.write(`${' '.repeat(nameCol + 2)}${colors.dim('· cmd: moxxy ' + spec.execArgs.join(' '))}\n`);
    if (status.unitPath) {
      process.stdout.write(`${' '.repeat(nameCol + 2)}${colors.dim('· unit: ' + status.unitPath)}\n`);
    }
    if (i < CATALOG.length - 1) process.stdout.write('\n');
  }
  return 0;
}

function stateBadge(status: ServiceStatus): string {
  if (!status.installed) return colors.dim('not installed');
  if (status.running) return colors.bold('running');
  return colors.yellow('installed · stopped');
}

async function runStatus(argv: ParsedArgv): Promise<number> {
  const name = argv.positional[1];
  if (!name) return await runList();
  const spec = findSpec(name);
  if (!spec) {
    process.stderr.write(`${colors.red(`unknown service: ${name}`)}\n`);
    return 2;
  }
  const s = await getServiceStatus(spec);
  const rows: Array<[string, string]> = [
    ['service', spec.id],
    ['platform', s.platform],
    ['installed', s.installed ? 'yes' : 'no'],
    ['running', s.running ? 'yes' : 'no'],
    ['cmd', 'moxxy ' + spec.execArgs.join(' ')],
    ['log', s.logPath],
  ];
  if (s.unitPath) rows.push(['unit', s.unitPath]);
  const col = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    process.stdout.write(`${colors.bold(k.padEnd(col))}  ${colors.dim(v)}\n`);
  }
  return 0;
}

async function runInstall(spec: ServiceSpec): Promise<number> {
  const result = await installAndStartService(spec);
  if (result.ok) {
    process.stdout.write(`${colors.bold('installed')}  ${spec.id}\n`);
    process.stdout.write(`           ${colors.dim(result.message)}\n`);
    process.stdout.write(`           ${colors.dim('log: ' + result.logPath)}\n`);
    process.stdout.write(`           ${colors.dim('manage: moxxy service status|logs|stop|uninstall ' + spec.id)}\n`);
    return 0;
  }
  process.stdout.write(`${colors.red('failed')}    ${spec.id}\n           ${colors.dim(result.message)}\n`);
  return 1;
}

async function runUninstall(spec: ServiceSpec): Promise<number> {
  const result = await stopAndUninstallService(spec);
  if (result.ok) {
    process.stdout.write(`${colors.bold('uninstalled')}  ${spec.id}  ${colors.dim(result.message)}\n`);
    return 0;
  }
  process.stdout.write(`${colors.red('failed')}       ${spec.id}  ${colors.dim(result.message)}\n`);
  return 1;
}

async function runStart(spec: ServiceSpec): Promise<number> {
  const result = await startInstalledService(spec);
  if (result.ok) {
    process.stdout.write(`${colors.bold('started')}  ${spec.id}  ${colors.dim(result.message)}\n`);
    return 0;
  }
  process.stdout.write(`${colors.red('failed')}   ${spec.id}  ${colors.dim(result.message)}\n`);
  return 1;
}

async function runStop(spec: ServiceSpec): Promise<number> {
  const result = await stopRunningService(spec);
  if (result.ok) {
    process.stdout.write(`${colors.bold('stopped')}  ${spec.id}  ${colors.dim(result.message)}\n`);
    return 0;
  }
  process.stdout.write(`${colors.red('failed')}   ${spec.id}  ${colors.dim(result.message)}\n`);
  return 1;
}

async function runRestart(spec: ServiceSpec): Promise<number> {
  await stopRunningService(spec);
  const result = await startInstalledService(spec);
  if (result.ok) {
    process.stdout.write(`${colors.bold('restarted')}  ${spec.id}\n`);
    return 0;
  }
  process.stdout.write(`${colors.red('failed')}     ${spec.id}  ${colors.dim(result.message)}\n`);
  return 1;
}

async function runLogs(spec: ServiceSpec, argv: ParsedArgv): Promise<number> {
  const linesArg = stringFlag(argv, 'lines');
  const lines = linesArg ? Number(linesArg) : 40;
  if (!Number.isFinite(lines) || lines <= 0) {
    process.stderr.write(colors.red('--lines must be a positive number') + '\n');
    return 2;
  }
  const text = await readServiceLog(spec, lines);
  if (!text) {
    process.stdout.write(colors.dim(`(no log yet at ${serviceLogPath(spec)})`) + '\n');
    return 0;
  }
  process.stdout.write(text);
  if (!text.endsWith('\n')) process.stdout.write('\n');
  return 0;
}

async function runPath(spec: ServiceSpec): Promise<number> {
  const s = await getServiceStatus(spec);
  if (!s.unitPath) {
    process.stderr.write(colors.red('no unit path on this platform') + '\n');
    return 1;
  }
  process.stdout.write(s.unitPath + '\n');
  return 0;
}
