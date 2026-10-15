import { agentCliNotice } from '@moxxy/chat-model';
import type { AgentCliAction, ProviderEntry } from '@moxxy/desktop-ipc-contract';

/** The states an agent connection's row can be in, from what the runner and this window know. */
export type AgentConnectionState =
  | 'checking'
  | 'not-installed'
  | 'installing'
  | 'install-failed'
  | 'not-connected'
  | 'connected'
  | 'update-available'
  | 'update-required'
  | 'unavailable';

/** The one thing the row offers: install, update, sign in, or check again. */
export type AgentConnectionAction = 'install' | 'update' | 'sign-in' | 'check';

/** An install or update this window started: running, or how it ended. */
export interface AgentCliJob {
  readonly action: AgentCliAction;
  readonly running: boolean;
  /** The last line it printed. */
  readonly line: string | null;
  /** 0–1 when it printed a percentage. */
  readonly fraction: number | null;
  /** Why it failed; null while running or after it worked. */
  readonly error: string | null;
}

export interface AgentConnectionView {
  readonly state: AgentConnectionState;
  /** One line under the name: the account, or what is wrong. */
  readonly detail: string;
  readonly action: AgentConnectionAction | null;
  /** 0–1 while installing or updating and it said how far; null otherwise. */
  readonly progress: number | null;
}

/**
 * The row of an agent connection (Claude, Codex, OpenCode) in Settings and in
 * onboarding. The runner's check says what is installed and signed in; this
 * window adds an install or update it is running and a check it asked for.
 */
export function agentConnectionView(
  entry: ProviderEntry,
  local: { readonly job: AgentCliJob | null; readonly checking: boolean },
): AgentConnectionView {
  const agent = entry.agentName ?? entry.name;
  const report = entry.agentCli;
  const { job } = local;
  const view = (state: AgentConnectionState, detail: string, action: AgentConnectionAction | null): AgentConnectionView => ({
    state,
    detail: job?.error && action !== null ? job.error : detail,
    action,
    progress: null,
  });

  if (job?.running) {
    const doing = job.action === 'install' ? `Installing ${agent}…` : `Updating ${agent}…`;
    return { state: 'installing', detail: job.line ?? doing, action: null, progress: job.fraction };
  }
  if (job?.error && job.action === 'install' && report?.state === 'missing') {
    return view('install-failed', job.error, 'install');
  }
  if (!report || local.checking) return { state: 'checking', detail: `Checking ${agent}…`, action: null, progress: null };

  const account = report.account ?? null;
  const notice = agentCliNotice(entry);
  switch (report.state) {
    case 'missing':
      return view('not-installed', `${agent} is not installed on this computer`, 'install');
    case 'unknown':
      return view('unavailable', `${agent} is installed, but Moxxy could not read its version`, 'check');
    case 'update-required':
      return view('update-required', notice?.text ?? `${agent} needs an update`, 'update');
    default:
      break;
  }
  if (report.signedIn === false || (report.signedIn === undefined && !entry.ready)) {
    return view('not-connected', `${agent} is not signed in`, 'sign-in');
  }
  const withAccount = (text: string): string => (account ? `${account} · ${text}` : text);
  if (report.state === 'update-available' && notice) {
    return view('update-available', withAccount(notice.text), 'update');
  }
  return view('connected', withAccount(`${agent} ${report.installed ?? ''}`.trim()), null);
}
