import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentCliAction, AgentCliProgress, AgentCliRunResult } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { AgentCliJob } from './agentConnection.js';

type Jobs = Readonly<Record<string, AgentCliJob>>;

export interface UseAgentClis {
  /** Installs and updates this window started, by connection name; one that worked is cleared. */
  readonly jobs: Jobs;
  /** True while a check this window asked for runs. */
  readonly checking: boolean;
  readonly run: (provider: string, action: AgentCliAction) => Promise<AgentCliRunResult>;
  readonly check: () => Promise<void>;
  /** Forgets how a job ended. */
  readonly close: (provider: string) => void;
}

/**
 * The window's jobs live outside any screen: an update outlasts the one that
 * started it, and the chat's card and Settings must tell the same story.
 */
const NONE: Jobs = {};
let jobs = NONE;
const listeners = new Set<() => void>();
let stopProgress: (() => void) | null = null;

function publish(next: Jobs): void {
  jobs = next;
  for (const listener of listeners) listener();
}

function change(provider: string, next: (job: AgentCliJob | undefined) => AgentCliJob | undefined): void {
  const job = next(jobs[provider]);
  const rest = { ...jobs };
  delete rest[provider];
  publish(job ? { ...rest, [provider]: job } : rest);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  stopProgress ??= api().subscribe('agents.progress', (p: AgentCliProgress) => {
    change(p.provider, (job) => (job?.running ? { ...job, line: p.line ?? job.line, fraction: p.fraction ?? job.fraction } : job));
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopProgress?.();
    stopProgress = null;
  };
}

const getJobs = (): Jobs => jobs;

/** What is left to say once it ended; nothing when it plainly worked. */
function afterRun(action: AgentCliAction, result: AgentCliRunResult): AgentCliJob | undefined {
  const ended = { action, running: false, line: null, fraction: null, error: null, note: null, retry: action };
  if (!result.ok) return { ...ended, error: result.message, retry: result.outcome === 'gone' ? 'install' : action };
  return result.outcome === 'unchanged' || result.outcome === 'unverified' ? { ...ended, note: result.message } : undefined;
}

async function run(provider: string, action: AgentCliAction): Promise<AgentCliRunResult> {
  if (jobs[provider]?.running) return { ok: false, message: 'It is already running.' };
  change(provider, () => ({ action, running: true, line: null, fraction: null, error: null, note: null, retry: action }));
  let result: AgentCliRunResult;
  try {
    result = await api().invoke('agents.run', { provider, action });
  } catch (e) {
    result = { ok: false, message: toErrorMessage(e) };
  }
  change(provider, () => afterRun(action, result));
  return result;
}

function close(provider: string): void {
  change(provider, (job) => (job?.running ? job : undefined));
}

/** A note says the version may show later; a check is what shows it. */
function forgetNotes(): void {
  publish(Object.fromEntries(Object.entries(jobs).filter(([, job]) => !job.note)));
}

export function __resetAgentClisForTests(): void {
  jobs = NONE;
  listeners.clear();
  stopProgress?.();
  stopProgress = null;
}

/**
 * Install or update the CLI behind an agent connection, or check every one
 * again. The new state comes back with the runner's info (`ProviderEntry.agentCli`).
 */
export function useAgentClis(): UseAgentClis {
  const current = useSyncExternalStore(subscribe, getJobs);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      await api().invoke('agents.check', undefined);
      forgetNotes();
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  return { jobs: current, checking, run, check, close };
}
