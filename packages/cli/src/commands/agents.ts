/**
 * `moxxy agents` — where the CLIs behind the Claude, Codex and OpenCode
 * connections stand, and installing or updating one with the vendor's own
 * installer or the agent's own update command.
 */
import {
  AGENT_CLIS,
  checkAgentCli,
  runAgentCliAction,
  type AgentCliDescriptor,
} from '@moxxy/agent-connection-kit';
import { agentCliApp, agentCliFile } from '@moxxy/chat-model';
import type { AgentCliReport } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { hasBoolFlag, helpRequested } from '../argv-helpers.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy agents',
  tagline: 'the Claude, Codex and OpenCode CLIs behind the agent connections',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['status [--json]', 'each agent: installed version, the latest, what to do next'],
        ['install <agent>', "install it with the vendor's installer"],
        ['update <agent>', "update it with the agent's own update command"],
      ],
    },
  ],
  footer: ['<agent> is claude, codex or opencode. Moxxy checks every hour while it runs; this checks now.'],
});

export interface AgentsDeps {
  readonly home?: string;
  readonly pathEnv?: string;
  /** The vendor's latest version; defaults to the registry, cached for an hour. */
  readonly latest?: (pkg: string, opts: { readonly refresh: boolean }) => Promise<string | null>;
  /** The agents by connection name; defaults to the ones Moxxy knows. */
  readonly agents?: Readonly<Record<string, AgentCliDescriptor>>;
  readonly out?: (s: string) => void;
  readonly err?: (s: string) => void;
}

export async function runAgentsCommand(argv: ParsedArgv, deps: AgentsDeps = {}): Promise<number> {
  const out = deps.out ?? ((s: string) => void process.stdout.write(s));
  const err = deps.err ?? ((s: string) => void process.stderr.write(s));
  const [action = 'status', name] = argv.positional;
  if (action === 'help' || helpRequested(argv)) {
    out(HELP);
    return 0;
  }
  const agents = { ...AGENT_CLIS, ...deps.agents };
  const search = {
    ...(deps.home !== undefined ? { home: deps.home } : {}),
    ...(deps.pathEnv !== undefined ? { pathEnv: deps.pathEnv } : {}),
  };

  if (action === 'status') {
    const reports = await Promise.all(
      Object.entries(agents).map(
        async ([connection, desc]) =>
          [connection, desc, await checkAgentCli(desc, { ...search, refresh: true }, deps.latest ? { latest: deps.latest } : {})] as const,
      ),
    );
    if (hasBoolFlag(argv, 'json')) {
      out(JSON.stringify(Object.fromEntries(reports.map(([connection, , report]) => [connection, report])), null, 2) + '\n');
      return 0;
    }
    const width = Math.max(...reports.map(([, desc]) => desc.name.length));
    for (const [, desc, report] of reports) {
      out(`${desc.name.padEnd(width)}  ${(report.installed ?? '—').padEnd(10)}  ${describe(desc, report)}\n`);
      const file = agentCliFile(report);
      if (file) out(`${' '.repeat(width + 2)}${colors.dim(file)}\n`);
    }
    return 0;
  }

  if (action !== 'install' && action !== 'update') {
    err(`unknown action "${action}"\n`);
    out(HELP);
    return 2;
  }
  const desc = name ? agentByName(agents, name) : undefined;
  if (!desc) {
    err(`which agent? one of: ${agentNames(agents).join(', ')}\n`);
    return 2;
  }
  const result = await runAgentCliAction(desc, action, {
    ...search,
    onLine: (line) => out(`${colors.dim(line)}\n`),
  });
  if (!result.ok) {
    err(`${desc.name}: ${result.message}\n`);
    return 1;
  }
  out(`${desc.name}: ${result.message}\n`);
  return 0;
}

/** By the command (`codex`) or the connection (`codex-agent`). */
function agentByName(agents: Readonly<Record<string, AgentCliDescriptor>>, name: string): AgentCliDescriptor | undefined {
  return agents[name] ?? Object.values(agents).find((desc) => desc.command === name);
}

function agentNames(agents: Readonly<Record<string, AgentCliDescriptor>>): string[] {
  return Object.values(agents).map((desc) => desc.command);
}

function describe(desc: AgentCliDescriptor, report: AgentCliReport): string {
  const app = agentCliApp(report);
  const fix = app ? `part of ${app}, which updates it` : `moxxy agents update ${desc.command}`;
  switch (report.state) {
    case 'missing':
      return `not installed · moxxy agents install ${desc.command}`;
    case 'update-required':
      return colors.yellow(`update required — Moxxy works with ${report.minimum} or newer · ${fix}`);
    case 'update-available':
      return `${report.latest ?? 'a newer version'} is out · ${fix}`;
    case 'unknown':
      return colors.yellow('installed, but its version could not be read');
    case 'current':
      return colors.green('up to date');
  }
}
