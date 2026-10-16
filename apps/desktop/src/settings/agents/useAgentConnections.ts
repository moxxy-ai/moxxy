import { useMemo } from 'react';
import {
  agentConnectionView,
  useAgentClis,
  type AgentConnectionView,
} from '@moxxy/client-core';
import type { AgentCliAction, ProviderEntry } from '@moxxy/desktop-ipc-contract';

export interface AgentConnectionRowModel {
  readonly entry: ProviderEntry;
  readonly view: AgentConnectionView;
  /** What the running or last install/update did, for its words. */
  readonly jobAction: AgentCliAction | null;
}

/** True for an agent connection (Claude, Codex, OpenCode): its agent works the turn. */
export function isAgentConnection(entry: ProviderEntry): boolean {
  return entry.agentName !== undefined;
}

/** The agent connections' rows, with installing, updating and checking them. */
export function useAgentConnections(providers: ReadonlyArray<ProviderEntry>): {
  readonly rows: ReadonlyArray<AgentConnectionRowModel>;
  readonly run: (provider: string, action: AgentCliAction) => void;
  readonly check: () => void;
} {
  const { jobs, checking, run, check } = useAgentClis();
  const rows = useMemo(
    () =>
      providers.filter(isAgentConnection).map((entry) => {
        const job = jobs[entry.name] ?? null;
        return { entry, view: agentConnectionView(entry, { job, checking }), jobAction: job?.action ?? null };
      }),
    [providers, jobs, checking],
  );
  return {
    rows,
    run: (provider, action) => void run(provider, action),
    check: () => void check().catch(() => undefined),
  };
}
