import type { AgentCliOrigin, AgentCliReport } from '@moxxy/sdk';

export interface AgentCliNotice {
  readonly provider: string;
  /** The CLI's command, which names it to `moxxy agents`. */
  readonly command: string;
  /**
   * `required`: the connection cannot work until it is installed or updated.
   * `issue`: the installed or the newest version has a known problem with Moxxy, and there is nothing to run yet.
   */
  readonly severity: 'required' | 'available' | 'issue';
  /** What fixes it from Moxxy; null when only the app the CLI is part of can. */
  readonly action: 'install' | 'update' | null;
  readonly text: string;
}

/** What a surface knows of a connection: its name, the agent's, and the last check of its CLI. */
export interface AgentConnectionLike {
  readonly name: string;
  readonly agentName?: string;
  readonly agentCli?: AgentCliReport;
}

/**
 * What to tell the person about an agent connection's CLI — missing, too old,
 * or behind the vendor's latest — so every surface says the same. Null when
 * there is nothing to say.
 */
export function agentCliNotice(connection: AgentConnectionLike): AgentCliNotice | null {
  const report = connection.agentCli;
  if (!report) return null;
  const agent = connection.agentName ?? connection.name;
  const base = { provider: connection.name, command: report.command };
  const file = agentCliFile(report);
  const where = file ? ` at ${file}` : '';
  const app = agentCliApp(report);
  const issue = report.knownIssue;
  const heldBack = issue && issue.version !== report.installed ? agentCliKnownIssue(report, agent) : null;
  switch (report.state) {
    case 'missing':
      return { ...base, severity: 'required', action: 'install', text: `${agent} is not installed` };
    case 'update-required': {
      const old = `${agent} ${report.installed ?? ''}`.trim() + `${where} is older than Moxxy works with`;
      return app
        ? { ...base, severity: 'required', action: null, text: `${old} — it is part of ${app}, which updates it` }
        : heldBack
          ? { ...base, severity: 'required', action: null, text: `${old} — ${heldBack}` }
          : report.manualUpdate
            ? { ...base, severity: 'required', action: null, text: `${old} — ${report.manualUpdate}` }
            : { ...base, severity: 'required', action: 'update', text: `${old} — update it to ${report.minimum} or newer` };
    }
    case 'update-available': {
      // An app brings its own copy up to date; there is nothing to do here.
      const broken = issue && !heldBack ? `, which has a known problem with Moxxy: ${issue.reason}` : '';
      return report.latest && !app
        ? { ...base, severity: 'available', action: report.manualUpdate ? null : 'update', text: `${agent} ${report.latest} is out — you have ${report.installed ?? 'an older one'}${where}${broken}${report.manualUpdate ? ` — ${report.manualUpdate}` : ''}` }
        : null;
    }
    case 'current': {
      const text = agentCliKnownIssue(report, agent);
      return text ? { ...base, severity: 'issue', action: null, text } : null;
    }
    default:
      return null;
  }
}

/**
 * What Moxxy knows is wrong with the installed version, or with the newest one
 * it holds back; null when nothing is. Every surface words it the same.
 * Without `agent` it starts at the version, for a line that names the agent already.
 */
export function agentCliKnownIssue(report: AgentCliReport, agent?: string): string | null {
  const issue = report.knownIssue;
  if (!issue) return null;
  const which = agent ? `${agent} ${issue.version}` : issue.version;
  return issue.version === report.installed
    ? `${which} has a known problem with Moxxy: ${issue.reason} — wait for a fixed version`
    : `${which} is out, but Moxxy holds it back: ${issue.reason}`;
}

/** How the file's origin reads after its path; the installer's and an unknown one need no word. */
const ORIGIN_LABEL: Readonly<Record<AgentCliOrigin, string>> = { installer: '', homebrew: 'Homebrew', winget: 'winget', npm: 'npm', bun: 'bun', pnpm: 'pnpm', yarn: 'yarn', volta: 'Volta', 'vite-plus': 'Vite+', mise: 'mise', app: '', unknown: '' };

/** The file a check was about, with where it came from ("/opt/homebrew/bin/claude (Homebrew)"); null when none was found. */
export function agentCliFile(report: AgentCliReport): string | null {
  if (!report.path) return null;
  const label = ORIGIN_LABEL[report.origin ?? 'unknown'];
  return label ? `${report.path} (${label})` : report.path;
}

/** The macOS app the checked CLI is part of ("ChatGPT.app"), which updates it; null for any other copy. */
export function agentCliApp(report: AgentCliReport): string | null {
  const file = report.origin === 'app' ? report.path : undefined;
  const at = file?.indexOf('.app/Contents/') ?? -1;
  if (!file || at < 0) return null;
  const bundle = file.slice(0, at + '.app'.length);
  return bundle.slice(bundle.lastIndexOf('/') + 1);
}

/** {@link agentCliNotice} for the conversation's active connection. */
export function activeAgentCliNotice(
  providers: ReadonlyArray<AgentConnectionLike>,
  activeProvider: string | null | undefined,
): AgentCliNotice | null {
  const info = providers.find((p) => p.name === activeProvider);
  return info ? agentCliNotice(info) : null;
}

/**
 * All that is worth saying at once: the active connection in full, then the
 * updates of the others. An agent not in use is never asked to install, and
 * gets only what the person can close.
 */
export function agentCliNotices(
  providers: ReadonlyArray<AgentConnectionLike>,
  activeProvider: string | null | undefined,
): ReadonlyArray<AgentCliNotice> {
  const active = activeAgentCliNotice(providers, activeProvider);
  const others = providers
    .filter((p) => p.name !== activeProvider)
    .map(agentCliNotice)
    .filter((n): n is AgentCliNotice => n?.severity === 'available' || n?.severity === 'issue');
  return active ? [active, ...others] : others;
}
