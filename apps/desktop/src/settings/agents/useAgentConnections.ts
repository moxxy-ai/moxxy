import { useEffect, useMemo, useRef } from 'react';
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
  /** Signed in, so its menu offers a sign-out. */
  readonly signedIn: boolean;
}

/** How long a check on coming back to the window counts: switching windows must not run the CLIs each time. */
export const CHECK_ON_RETURN_GAP_MS = 30_000;

/** True for an agent connection (Claude, Codex, OpenCode): its agent works the turn. */
export function isAgentConnection(entry: ProviderEntry): boolean {
  return entry.agentName !== undefined;
}

/**
 * Checks the agents again when the person comes back to the window, at most
 * once per {@link CHECK_ON_RETURN_GAP_MS}: a sign-in or update done in a
 * terminal or a browser shows without a click.
 */
function useCheckOnReturn(check: () => void, enabled: boolean): void {
  const latest = useRef(check);
  latest.current = check;
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const onReturn = (): void => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (last.current !== null && now - last.current < CHECK_ON_RETURN_GAP_MS) return;
      last.current = now;
      latest.current();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [enabled]);
}

/** The agent connections' rows, with installing, updating, checking and signing out of them. */
export function useAgentConnections(providers: ReadonlyArray<ProviderEntry>): {
  readonly rows: ReadonlyArray<AgentConnectionRowModel>;
  readonly checking: boolean;
  readonly run: (provider: string, action: AgentCliAction) => void;
  readonly check: () => void;
  readonly signOut: (provider: string) => Promise<{ readonly ok: boolean; readonly message: string }>;
} {
  const { jobs, checking, run, check, signOut } = useAgentClis();
  const rows = useMemo(
    () =>
      providers.filter(isAgentConnection).map((entry) => {
        const job = jobs[entry.name] ?? null;
        const view = agentConnectionView(entry, { job, checking });
        return {
          entry,
          view,
          jobAction: job?.action ?? null,
          signedIn: entry.agentCli?.signedIn === true || view.state === 'connected' || view.state === 'update-available',
        };
      }),
    [providers, jobs, checking],
  );
  const checkNow = (): void => void check().catch(() => undefined);
  useCheckOnReturn(checkNow, rows.length > 0);
  return {
    rows,
    checking,
    run: (provider, action) => void run(provider, action),
    check: checkNow,
    signOut,
  };
}
