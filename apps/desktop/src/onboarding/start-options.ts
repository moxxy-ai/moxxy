/**
 * The choices of the first-run question, in a person's words. Pure: it reads
 * an agent connection's row ({@link agentConnectionView}) and says what the
 * row means to someone who never heard of a CLI or a sign-in token.
 */

import { agentConnectionView, type AgentCliJob } from '@moxxy/client-core';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';

/** The plans a person may already pay for, in the order they are offered. */
export const PLAN_PROVIDERS = ['claude-code', 'codex-agent'] as const;
/** The connection behind "Start free": OpenCode's free model needs no account. */
export const FREE_PROVIDER = 'opencode';

export type StartProvider = (typeof PLAN_PROVIDERS)[number] | typeof FREE_PROVIDER;

/** What pressing the choice does next, or that it can be used now. */
export type StartOptionState =
  | 'checking'
  | 'install'
  | 'installing'
  | 'failed'
  | 'update'
  | 'sign-in'
  | 'ready'
  | 'unavailable';

export interface StartOption {
  readonly provider: StartProvider;
  /** The name a person knows it by: "Claude", "ChatGPT". */
  readonly name: string;
  readonly state: StartOptionState;
  /** One plain line under the name. */
  readonly detail: string;
  /** 0–1 while installing, when the install said how far it got. */
  readonly progress: number | null;
}

const NAME: Record<StartProvider, string> = {
  'claude-code': 'Claude',
  'codex-agent': 'ChatGPT',
  opencode: 'Free model',
};

function detailFor(provider: StartProvider, state: StartOptionState, progress: number | null, account: string | null): string {
  switch (state) {
    case 'checking':
      return 'Checking this computer…';
    case 'install':
      return 'Moxxy installs it for you. It takes about a minute.';
    case 'installing':
      return progress === null ? 'Installing…' : `Installing… ${Math.round(progress * 100)}%`;
    case 'failed':
      return 'The install did not finish. Try again.';
    case 'update':
      return 'It needs an update first. Moxxy does it for you.';
    case 'sign-in':
      return `Sign in with your ${NAME[provider]} account`;
    case 'unavailable':
      return 'Moxxy could not check it. Try again.';
    case 'ready':
      if (provider === FREE_PROVIDER) return 'No account needed.';
      return account ? `Signed in as ${account}` : 'Ready to use';
  }
}

function stateFor(view: ReturnType<typeof agentConnectionView>): StartOptionState {
  switch (view.state) {
    case 'checking':
      return 'checking';
    case 'not-installed':
      return 'install';
    case 'installing':
      return 'installing';
    case 'install-failed':
      return 'failed';
    case 'update-required':
      return 'update';
    case 'not-connected':
      return 'sign-in';
    case 'unavailable':
      return 'unavailable';
    case 'connected':
    case 'update-available':
      return 'ready';
  }
}

/**
 * One choice, from its connection's row. `listed` says the host's list is in:
 * an agent it does not name (a home with no agent plugin yet) goes through the
 * sign-in, which brings its plugin along, as the first run always did.
 */
export function startOption(
  provider: StartProvider,
  entry: ProviderEntry | undefined,
  local: { readonly job: AgentCliJob | null; readonly checking: boolean; readonly listed?: boolean },
): StartOption {
  const view = entry ? agentConnectionView(entry, local) : null;
  const known = view ? stateFor(view) : local.listed === true ? 'sign-in' : 'checking';
  // Installed is enough for the free model: it never signs in. Before a runner
  // runs, no agent's sign-in is known and every row would say "Sign in".
  const state = provider === FREE_PROVIDER && known === 'sign-in' ? 'ready' : known;
  const progress = view?.progress ?? null;
  const cli = entry?.agentCli;
  const account = cli?.account ?? null;
  return { provider, name: NAME[provider], state, detail: detailFor(provider, state, progress, account), progress };
}

/** The first plan already signed in on this computer, offered as one press; null when none is. */
export function readyPlan(options: ReadonlyArray<StartOption>): StartOption | null {
  return options.find((option) => option.provider !== FREE_PROVIDER && option.state === 'ready') ?? null;
}
