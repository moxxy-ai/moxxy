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
  /** The host has yet to start the installer. */
  readonly preparing?: boolean;
  /** The last line it printed. */
  readonly line: string | null;
  /** 0–1 when it printed a percentage. */
  readonly fraction: number | null;
  /** Why it failed; null while running or after it worked. */
  readonly error: string | null;
  /** One diagnostic from a failed install, when available. */
  readonly details?: string | null;
  /** What to know about one that ended without proof it worked; null otherwise. */
  readonly note: string | null;
  /** What brings it back: the same again, or an install when the update took the copy with it. */
  readonly retry: AgentCliAction;
}

export interface AgentConnectionView {
  readonly state: AgentConnectionState;
  /** One line under the name: the account, or what is wrong. */
  readonly detail: string;
  readonly action: AgentConnectionAction | null;
  /** 0–1 while installing or updating and it said how far; null otherwise. */
  readonly progress: number | null;
  /** The failed install diagnostic for the details disclosure, or null. */
  readonly details: string | null;
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
    detail: job?.note ?? (job?.error && action !== null ? job.error : detail),
    action,
    progress: null,
    details: null,
  });

  if (job?.running) {
    // The chip already says it installs; the installer's own lines go to its log file, as
    // they read like a console. At 100% the download is in and Moxxy checks the copy it left.
    const detail = job.fraction === 1 ? 'Almost done…' : 'This usually takes about a minute.';
    return { state: 'installing', detail, action: null, progress: job.fraction, details: null };
  }
  if (job?.error && job.action === 'install' && report?.state === 'missing') {
    return { ...view('install-failed', job.error, 'install'), details: job.details ?? null };
  }
  if (!report || local.checking) return { state: 'checking', detail: `Checking ${agent}…`, action: null, progress: null, details: null };

  const account = report.account ?? null;
  const notice = agentCliNotice(entry);
  switch (report.state) {
    case 'missing':
      return view('not-installed', `${agent} is not installed on this computer`, 'install');
    case 'unknown':
      return view('unavailable', `${agent} is installed, but Moxxy could not read its version`, 'check');
    case 'update-required':
      // A CLI inside an app is updated by that app, not from here.
      return view('update-required', notice?.text ?? `${agent} needs an update`, notice?.action === null ? null : 'update');
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
  // A version with a known problem: still usable, with nothing to run until a fixed one is out.
  if (notice?.severity === 'issue') return view('connected', withAccount(notice.text), null);
  return view('connected', withAccount(`${agent} ${report.installed ?? ''}`.trim()), null);
}

/**
 * Whether a provider shows as connected in Settings → Providers, and so can be
 * picked: an agent that is installed, new enough and signed in, a local server
 * that answers, or a provider whose key resolved. Never one turned off.
 */
export function isProviderConnected(entry: ProviderEntry): boolean {
  if (!entry.enabled) return false;
  if (entry.agentName !== undefined) {
    const { state } = agentConnectionView(entry, { job: null, checking: false });
    return state === 'connected' || state === 'update-available';
  }
  if (entry.name === 'local') return entry.connected === true;
  return entry.ready;
}
