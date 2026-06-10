import { useCallback, useEffect, useState } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

/**
 * Human-in-the-loop: a workflow step with `awaitInput: true` pauses to ask the
 * operator a question, then resumes with their reply. This hook surfaces every
 * currently-paused run so the UI can show "Workflow <name> is waiting: <prompt>"
 * with a reply box, and exposes {@link UsePausedWorkflows.resume} to answer.
 *
 * Source of truth is the runner's `workflow_paused` / `workflow_resumed` /
 * `workflow_completed` / `workflow_failed` plugin events (delivered over
 * `runner.event`). It is intentionally NOT polled — the events keep the set
 * live. A run leaves the set the moment it resumes (so the card can't be
 * double-submitted) and re-enters if it pauses again at a later awaitInput step.
 */
export interface PausedWorkflow {
  /** The paused run id — pass to {@link UsePausedWorkflows.resume}. */
  readonly runId: string;
  /** The workflow's name. */
  readonly workflow: string;
  /** The paused step's id. */
  readonly stepId: string;
  /** Human label of the paused step. */
  readonly label: string;
  /** The question the workflow asked the operator. */
  readonly prompt: string;
}

export interface UsePausedWorkflows {
  /** Every run currently parked on an awaitInput step, newest last. */
  readonly paused: ReadonlyArray<PausedWorkflow>;
  /** Per-run error from a failed resume attempt (keyed by runId). */
  readonly errors: Readonly<Record<string, string>>;
  /** Runs whose resume is in flight (so the UI can disable the submit). */
  readonly resuming: ReadonlyArray<string>;
  /** Answer a paused run's question and resume it. */
  readonly resume: (runId: string, reply: string) => Promise<void>;
}

interface PausedPayload {
  runId?: unknown;
  stepId?: unknown;
  workflow?: unknown;
  label?: unknown;
  prompt?: unknown;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A `workflow_paused` plugin event → a PausedWorkflow, or null if malformed. */
function toPaused(event: MoxxyEvent): PausedWorkflow | null {
  if (event.type !== 'plugin_event' || event.subtype !== 'workflow_paused') return null;
  const p = (event.payload ?? {}) as PausedPayload;
  const runId = str(p.runId);
  if (!runId) return null;
  return {
    runId,
    workflow: str(p.workflow, 'workflow'),
    stepId: str(p.stepId),
    label: str(p.label, str(p.stepId, 'step')),
    prompt: str(p.prompt),
  };
}

/** The runId a resume/complete/fail event clears from the paused set. */
function clearsRunId(event: MoxxyEvent): string | null {
  if (event.type !== 'plugin_event') return null;
  if (event.subtype !== 'workflow_resumed' && event.subtype !== 'workflow_completed' && event.subtype !== 'workflow_failed') {
    return null;
  }
  const runId = (event.payload as { runId?: unknown } | undefined)?.runId;
  return typeof runId === 'string' ? runId : null;
}

export function usePausedWorkflows(): UsePausedWorkflows {
  const [paused, setPaused] = useState<ReadonlyArray<PausedWorkflow>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resuming, setResuming] = useState<ReadonlyArray<string>>([]);

  useEffect(() => {
    const off = api().subscribe('runner.event', ({ event }: { event: MoxxyEvent }) => {
      const next = toPaused(event);
      if (next) {
        // Re-pausing at a new step replaces the entry for the same run.
        setPaused((cur) => [...cur.filter((p) => p.runId !== next.runId), next]);
        return;
      }
      const cleared = clearsRunId(event);
      if (cleared) {
        setPaused((cur) => cur.filter((p) => p.runId !== cleared));
        setErrors((cur) => {
          if (!(cleared in cur)) return cur;
          const { [cleared]: _drop, ...rest } = cur;
          return rest;
        });
      }
    });
    return off;
  }, []);

  const resume = useCallback(async (runId: string, reply: string): Promise<void> => {
    setResuming((cur) => (cur.includes(runId) ? cur : [...cur, runId]));
    setErrors((cur) => {
      if (!(runId in cur)) return cur;
      const { [runId]: _drop, ...rest } = cur;
      return rest;
    });
    try {
      const result = await api().invoke('workflows.resume', { runId, reply });
      // The `workflow_resumed`/`workflow_completed` event removes the card, but
      // clear optimistically too in case events are dropped on this transport.
      setPaused((cur) => cur.filter((p) => p.runId !== runId));
      if (!result.ok && result.error) {
        setErrors((cur) => ({ ...cur, [runId]: result.error! }));
      }
    } catch (e) {
      setErrors((cur) => ({ ...cur, [runId]: toErrorMessage(e) }));
    } finally {
      setResuming((cur) => cur.filter((id) => id !== runId));
    }
  }, []);

  return { paused, errors, resuming, resume };
}
