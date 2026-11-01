import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SESSION_INFO_REFRESH_EVENT,
  type AgentCliAction,
  type AgentCliProgress,
  type AgentCliRunResult,
} from '@moxxy/desktop-ipc-contract';
import { getPlatform } from './platform.js';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { AgentCliJob } from './agentConnection.js';

export interface UseAgentClis {
  /** Installs and updates this window started, by connection name; one that worked is cleared. */
  readonly jobs: Readonly<Record<string, AgentCliJob>>;
  /** True while a check this window asked for runs. */
  readonly checking: boolean;
  readonly run: (provider: string, action: AgentCliAction) => Promise<AgentCliRunResult>;
  readonly check: () => Promise<void>;
}

/** Before any runner is up no runner reports the new state, so every view reads it again. */
const readAgain = (): void => getPlatform().eventBus?.emit(SESSION_INFO_REFRESH_EVENT);

/**
 * Install or update the CLI behind an agent connection, or check every one
 * again. The new state comes back with the runner's info (`ProviderEntry.agentCli`).
 */
export function useAgentClis(): UseAgentClis {
  const [jobs, setJobs] = useState<Readonly<Record<string, AgentCliJob>>>({});
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback((provider: string, next: (job: AgentCliJob | undefined) => AgentCliJob | undefined) => {
    if (!mounted.current) return;
    setJobs((all) => {
      const job = next(all[provider]);
      const rest = { ...all };
      delete rest[provider];
      return job ? { ...rest, [provider]: job } : rest;
    });
  }, []);

  useEffect(
    () =>
      api().subscribe('agents.progress', (p: AgentCliProgress) => {
        update(p.provider, (job) =>
          job?.running ? { ...job, line: p.line ?? job.line, fraction: p.fraction ?? job.fraction } : job,
        );
      }),
    [update],
  );

  const run = useCallback(
    async (provider: string, action: AgentCliAction): Promise<AgentCliRunResult> => {
      update(provider, () => ({ action, running: true, line: null, fraction: null, error: null }));
      let result: AgentCliRunResult;
      try {
        result = await api().invoke('agents.run', { provider, action });
      } catch (e) {
        result = { ok: false, message: toErrorMessage(e) };
      }
      update(provider, () => (result.ok ? undefined : { action, running: false, line: null, fraction: null, error: result.message }));
      readAgain();
      return result;
    },
    [update],
  );

  const check = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      await api().invoke('agents.check', undefined);
    } finally {
      if (mounted.current) setChecking(false);
      readAgain();
    }
  }, []);

  return { jobs, checking, run, check };
}
