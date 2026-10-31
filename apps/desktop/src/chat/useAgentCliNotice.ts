import { agentCliFile, agentCliNotices, type AgentCliNotice, type AgentConnectionLike } from '@moxxy/chat-model';
import { useAgentClis, usePrefs, type AgentCliJob } from '@moxxy/client-core';
import type { AgentCliAction } from '@moxxy/desktop-ipc-contract';
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
  /** The words on that button, and its name for someone who cannot see the card. */
  readonly fixLabel: string;
  readonly fixName: string;
  /** Closes how an update ended, or an offer until the vendor publishes another version; absent when the agent cannot work without the fix. */
  readonly dismiss?: () => void;
  readonly dismissTip?: string;
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
  const install = (job?.action ?? notice.action) === 'install';
  if (job?.running) return { title: `${install ? 'Installing' : 'Updating'} ${agentName}`, detail: job.line ?? 'Starting…' };
  if (job?.error) return { title: `${install ? 'Install' : 'Update'} failed: ${agentName}`, detail: job.error };
  if (job?.note) return { title: `Update finished: ${agentName}`, detail: job.note };
  if (install) return { title: `Not installed: ${agentName}`, detail: `${report.command} was not found on this computer` };
  const title = `Update ${notice.severity === 'required' ? 'required' : 'available'}: ${agentName}`;
  return { title, detail: (notice.action && versions(report)) || briefly(notice, agentName, report) };
}

const verbOf = (action: AgentCliAction | null): string => (action === 'install' ? 'Install' : 'Update');

/** What the toast corner says about the agents' CLIs: the fix and, for an optional update, closing it for that version. */
export function useAgentCliNotices(info: AgentCliNoticeInfo | null | undefined): ReadonlyArray<AgentCliNoticeView> {
  const { jobs, run, check, close } = useAgentClis();
  const { prefs, update } = usePrefs();
  if (!info || !prefs) return [];
  const dismissed = prefs.dismissedAgentUpdates;
  const views: AgentCliNoticeView[] = [];
  const notices = agentCliNotices(info.providers, info.activeProvider);
  // A job and how it ended must outlast its offer, which the update itself can end.
  const results = info.providers.flatMap((p): AgentCliNotice[] => {
    const job = jobs[p.name];
    if (!job || !p.agentCli || notices.some((n) => n.provider === p.name)) return [];
    const text = job.error ?? job.note ?? '';
    return [{ provider: p.name, command: p.agentCli.command, severity: 'available', action: job.retry, text }];
  });
  for (const notice of [...notices, ...results]) {
    const entry = info.providers.find((p) => p.name === notice.provider);
    const report = entry?.agentCli;
    if (!entry || !report) continue;
    const job = jobs[notice.provider];
    const ended = job && (job.error ?? job.note) ? job : null;
    const latest = report.latest ?? null;
    if (!ended && notice.severity === 'available' && latest !== null && dismissed?.[notice.provider] === latest) continue;
    const action = ended ? ended.retry : notice.action;
    const agentName = entry.agentName ?? entry.name;
    const verb = verbOf(action);
    const retried = ended?.error ? (ended.retry === ended.action ? 'Try again' : verb) : verb;
    const closes = ended
      ? () => close(notice.provider)
      : notice.severity === 'available' && latest !== null
        ? () => void update({ dismissedAgentUpdates: { ...dismissed, [notice.provider]: latest } })
        : undefined;
    const fix = action
      ? () =>
          void run(notice.provider, action).then((result) => {
            if (result.ok && (!result.outcome || result.outcome === 'updated')) {
              pushToast({ id: `agent-update:${notice.provider}`, tone: 'success', title: `${agentName} is ready` });
            }
          })
      : undefined;
    views.push({
      notice,
      agentName,
      ...wording(notice, agentName, report, job),
      running: job?.running === true,
      fraction: job?.fraction ?? null,
      failed: Boolean(job?.error),
      ...(ended?.note ? { fix: () => void check() } : fix ? { fix } : {}),
      fixLabel: ended?.note ? 'Check again' : retried,
      fixName: ended?.note ? `Check ${agentName} again` : `${verb} ${agentName}`,
      ...(closes ? { dismiss: closes, ...(ended ? {} : { dismissTip: 'Hide until a newer version' }) } : {}),
    });
  }
  return views;
}
