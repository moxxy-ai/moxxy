import { agentCliFile, agentCliNotices, type AgentCliNotice, type AgentConnectionLike } from '@moxxy/chat-model';
import { useAgentClis, usePrefs, type AgentCliJob } from '@moxxy/client-core';
import type { AgentCliReport } from '@moxxy/sdk';
import { pushToast } from '../notices/toast-store';

export interface AgentCliNoticeView {
  readonly notice: AgentCliNotice;
  readonly agentName: string;
  readonly title: string;
  /** The line under the title: versions, the running step, or the failure. */
  readonly detail: string;
  /** The install or update runs. */
  readonly running: boolean;
  /** How far it got; null when it has not said. */
  readonly fraction: number | null;
  readonly failed: boolean;
  /** Runs the install or update; absent when Moxxy cannot fix it (a CLI inside an app). */
  readonly fix?: () => void;
  /** Closes it until the vendor publishes another version; absent when the agent cannot work without the fix. */
  readonly dismiss?: () => void;
}

/** What this needs of the session's info. */
export interface AgentCliNoticeInfo {
  readonly providers: ReadonlyArray<AgentConnectionLike>;
  readonly activeProvider?: string | null;
}

/** "v2.1.314 → v2.1.316"; null when either end is unknown. */
function versions(report: AgentCliReport): string | null {
  const target = report.latest ?? report.minimum;
  return report.installed && target ? `v${report.installed} → v${target}` : null;
}

/** The notice's sentence for a small card: no file, and no second mention of the agent. */
function briefly(notice: AgentCliNotice, agentName: string, report: AgentCliReport): string {
  const file = agentCliFile(report);
  const words = file ? notice.text.replace(` at ${file}`, '') : notice.text;
  const rest = words.slice(agentName.length + 1);
  return /^\d/.test(rest) ? rest : words;
}

function wording(notice: AgentCliNotice, agentName: string, report: AgentCliReport, job: AgentCliJob | undefined): { title: string; detail: string } {
  const install = notice.action === 'install';
  if (job?.running) return { title: `${install ? 'Installing' : 'Updating'} ${agentName}`, detail: job.line ?? 'Starting…' };
  if (job?.error) return { title: `${install ? 'Install' : 'Update'} failed: ${agentName}`, detail: job.error };
  if (install) return { title: `Not installed: ${agentName}`, detail: `${report.command} was not found on this computer` };
  const title = `Update ${notice.severity === 'required' ? 'required' : 'available'}: ${agentName}`;
  return { title, detail: (notice.action && versions(report)) || briefly(notice, agentName, report) };
}

/** What the toast corner says about the agents' CLIs: the fix and, for an optional update, closing it for that version. */
export function useAgentCliNotices(info: AgentCliNoticeInfo | null | undefined): ReadonlyArray<AgentCliNoticeView> {
  const { jobs, run } = useAgentClis();
  const { prefs, update } = usePrefs();
  if (!info || !prefs) return [];
  const dismissed = prefs.dismissedAgentUpdates;
  const views: AgentCliNoticeView[] = [];
  const notices = agentCliNotices(info.providers, info.activeProvider);
  // A failed update can leave nothing to offer, and its card must outlast that to say why.
  const failures = info.providers.flatMap((p): AgentCliNotice[] =>
    jobs[p.name]?.error && p.agentCli && !notices.some((n) => n.provider === p.name)
      ? [{ provider: p.name, command: p.agentCli.command, severity: 'available', action: 'update', text: jobs[p.name]?.error ?? '' }]
      : [],
  );
  for (const notice of [...notices, ...failures]) {
    const entry = info.providers.find((p) => p.name === notice.provider);
    const report = entry?.agentCli;
    if (!entry || !report) continue;
    const latest = report.latest ?? null;
    if (notice.severity === 'available' && latest !== null && dismissed?.[notice.provider] === latest) continue;
    const job = jobs[notice.provider];
    const action = notice.action;
    const agentName = entry.agentName ?? entry.name;
    views.push({
      notice,
      agentName,
      ...wording(notice, agentName, report, job),
      running: job?.running === true,
      fraction: job?.fraction ?? null,
      failed: Boolean(job?.error),
      ...(action
        ? {
            fix: () =>
              void run(notice.provider, action).then((result) => {
                if (result.ok) pushToast({ id: `agent-update:${notice.provider}`, tone: 'success', title: `${agentName} is ready` });
              }),
          }
        : {}),
      ...(notice.severity === 'available' && latest !== null
        ? { dismiss: () => void update({ dismissedAgentUpdates: { ...dismissed, [notice.provider]: latest } }) }
        : {}),
    });
  }
  return views;
}
