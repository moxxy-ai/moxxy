/**
 * Installing and updating the CLI behind an agent connection (Claude, Codex,
 * OpenCode) from the desktop. The vendor's installer or the agent's own update
 * command runs on this computer; its lines stream to the window; afterwards
 * every runner checks its agent CLIs again, so the new state reaches every
 * client through the session's info.
 */
import {
  AGENT_CLIS,
  checkAgentCli,
  defaultCacheFile,
  runAgentCliAction,
  type AgentCliDescriptor,
  type AgentCliSearch,
} from '@moxxy/agent-connection-kit';
import type { AgentCliReport } from '@moxxy/sdk';
import type { AgentCliAction, AgentCliProgress, AgentCliRunResult, ProviderEntry } from '@moxxy/desktop-ipc-contract';
import { delimiter } from 'node:path';
import { moxxyPath } from '@moxxy/sdk/server';
import { fallbackPathDirs, spawnPath } from './cli-resolver';
import type { RunnerPool } from './runner-pool';
import { bundledRuntimesReady } from './seed-runtimes';

/** What this needs of a runner: whether a turn runs, and asking it to check again. */
export interface AgentCliRunner {
  getInfo(): { readonly runningTurns?: ReadonlyArray<string> };
  readonly providerAdmin: {
    checkAgents(): Promise<void>;
    /** Ends the agent's live sessions (runner protocol v34); an older runner has none to end. */
    closeAgentSessions?(name: string): Promise<void>;
  };
}

/** What a sign-out ended with: whether it worked, and what to tell the person. */
export interface AgentSignOutResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface AgentSignOutDeps {
  readonly runners: () => ReadonlyArray<AgentCliRunner>;
  /** Signs the account out the way the terminal does (`moxxy login logout <provider>`). */
  readonly logout: (provider: string) => Promise<AgentSignOutResult>;
}

export interface AgentCliRunDeps {
  readonly runners: () => ReadonlyArray<AgentCliRunner>;
  readonly emit: (progress: AgentCliProgress) => void;
  readonly agents?: Readonly<Record<string, AgentCliDescriptor>>;
  /** Where to look; defaults to where a runner looks, so the update reaches the copy it checked. */
  readonly search?: AgentCliSearch;
  /** Folders the desktop put first on its own PATH (its Node); an update runs with them last. */
  readonly hostPathDirs?: ReadonlyArray<string>;
}

/** The PATH a runner gets from {@link spawnPath}, with the same folders marked as a fallback. */
function runnerSearch(): AgentCliSearch {
  return { pathEnv: spawnPath([]), fallbackPathEnv: fallbackPathDirs().join(delimiter) };
}

const running = new Set<string>();

/**
 * The agent connections as Settings and onboarding list them, read on this
 * computer while no runner is up: on a first run the runner starts only once
 * setup finishes, minutes later, and the person should be able to install
 * an agent meanwhile. A runner, once up, reports the same entries itself.
 */
export async function agentConnectionsWithoutRunner(
  check: (desc: AgentCliDescriptor) => Promise<AgentCliReport> = (desc) => checkAgentCli(desc, runnerSearch()),
): Promise<ProviderEntry[]> {
  const { builtinProviderKeyName } = await import('./provider-discovery');
  return Promise.all(
    Object.entries(AGENT_CLIS).map(async ([name, desc]) => {
      const agentCli = await check(desc).catch(() => undefined);
      return {
        name,
        ready: false,
        enabled: true,
        active: false,
        authKind: 'oauth' as const,
        kind: 'builtin' as const,
        keyName: builtinProviderKeyName(name),
        agentName: desc.name,
        ...(agentCli ? { agentCli } : {}),
      };
    }),
  );
}

/** Every runner that is up, as the agent-CLI checks see it. */
export function agentCliRunners(pool: Pick<RunnerPool, 'list'>): AgentCliRunner[] {
  return pool.list().flatMap(({ supervisor }) => {
    const remote = supervisor.remote();
    return remote ? [remote] : [];
  });
}

/** Every runner checks its agent CLIs again; one that cannot (an older runner) is skipped. */
export async function checkAgentClis(runners: ReadonlyArray<AgentCliRunner>): Promise<void> {
  await Promise.allSettled(runners.map((runner) => runner.providerAdmin.checkAgents()));
}

/**
 * Sign out of an agent connection. Every runner ends the agent's live sessions
 * first: a running agent (Codex's app-server) holds the account and writes it
 * back, which would undo the sign-out. Not while a turn runs, since ending its
 * agent would cut the turn off. Afterwards every runner checks its agents again.
 */
export async function signOutAgent(provider: string, deps: AgentSignOutDeps): Promise<AgentSignOutResult> {
  const runners = deps.runners();
  if (runners.some((runner) => (runner.getInfo().runningTurns?.length ?? 0) > 0)) {
    return { ok: false, message: 'Wait until the running turns end: signing out ends the agent they run on.' };
  }
  await Promise.allSettled(runners.map((runner) => runner.providerAdmin.closeAgentSessions?.(provider)));
  const result = await deps.logout(provider);
  await checkAgentClis(runners);
  return result;
}

/**
 * Where the last install or update of an agent's CLI is kept, all it printed and
 * how it ended: the window shows one line at a time, and an install that went
 * wrong on someone's computer can be read here afterwards.
 */
export function agentCliLogFile(desc: Pick<AgentCliDescriptor, 'command'>): string {
  return moxxyPath('logs', `agent-${desc.command}.log`);
}

export async function runAgentCli(
  provider: string,
  action: AgentCliAction,
  deps: AgentCliRunDeps,
): Promise<AgentCliRunResult> {
  const desc = (deps.agents ?? AGENT_CLIS)[provider];
  if (!desc) return { ok: false, message: `${provider} has no agent CLI to install or update.` };
  if (running.has(provider)) return { ok: false, message: `${desc.name} is already being installed or updated.` };
  // A running turn talks to the installed CLI; replacing it mid-turn can break the turn.
  if (action === 'update' && deps.runners().some((runner) => (runner.getInfo().runningTurns?.length ?? 0) > 0)) {
    return { ok: false, message: `Wait until the running turns end: the update replaces the ${desc.name} they run on.` };
  }
  running.add(provider);
  try {
    if (action === 'install') {
      // On a fresh launch the installer may need npm before the runner exists.
      await bundledRuntimesReady();
      deps.emit({ provider, action });
    }
    let fraction: number | undefined;
    const result = await runAgentCliAction(desc, action, {
      ...(deps.search ?? runnerSearch()),
      cacheFile: defaultCacheFile(),
      logFile: agentCliLogFile(desc),
      hostPathDirs: deps.hostPathDirs ?? [],
      onProgress: (next) => {
        fraction = next;
      },
      onLine: (line) => {
        deps.emit({ provider, action, line, ...(fraction !== undefined ? { fraction } : {}) });
        fraction = undefined;
      },
    });
    await checkAgentClis(deps.runners());
    return result;
  } finally {
    running.delete(provider);
  }
}
