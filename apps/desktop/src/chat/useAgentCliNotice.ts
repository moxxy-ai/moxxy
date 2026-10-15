import { useCallback } from 'react';
import { activeAgentCliNotice, type AgentCliNotice, type AgentConnectionLike } from '@moxxy/chat-model';
import { useAgentClis, usePrefs } from '@moxxy/client-core';

export interface AgentCliNoticeView {
  readonly notice: AgentCliNotice;
  readonly agentName: string;
  /** The install or update runs; its last line, when it printed one. */
  readonly running: boolean;
  readonly line: string | null;
  readonly error: string | null;
  readonly fix: () => void;
  /** Closes it until the vendor publishes another version; absent when the agent cannot work without the fix. */
  readonly dismiss?: () => void;
}

/**
 * What to say above the message box about the active agent's CLI, with the
 * fix and, for an optional update, closing it for that version.
 */
/** What this needs of the session's info. */
export interface AgentCliNoticeInfo {
  readonly providers: ReadonlyArray<AgentConnectionLike>;
  readonly activeProvider?: string | null;
}

export function useAgentCliNotice(info: AgentCliNoticeInfo | null | undefined): AgentCliNoticeView | null {
  const { jobs, run } = useAgentClis();
  const { prefs, update } = usePrefs();
  const notice = info ? activeAgentCliNotice(info.providers, info.activeProvider) : null;
  const provider = notice?.provider;
  const entry = info?.providers.find((p) => p.name === provider);
  const latest = entry?.agentCli?.latest ?? null;
  const dismissed = prefs?.dismissedAgentUpdates;
  const dismiss = useCallback(() => {
    if (!provider || !latest) return;
    void update({ dismissedAgentUpdates: { ...dismissed, [provider]: latest } });
  }, [provider, latest, dismissed, update]);

  if (!notice || !entry || !prefs) return null;
  if (notice.severity === 'available' && latest !== null && dismissed?.[notice.provider] === latest) return null;
  const job = jobs[notice.provider];
  return {
    notice,
    agentName: entry.agentName ?? entry.name,
    running: job?.running === true,
    line: job?.line ?? null,
    error: job?.error ?? null,
    fix: () => void run(notice.provider, notice.action),
    ...(notice.severity === 'available' ? { dismiss } : {}),
  };
}
