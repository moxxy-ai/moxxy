import { useSyncExternalStore } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { AskRequest, AskResponse } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';

/**
 * Pending interactive asks (permission / approval prompts the runner forwarded
 * via `ask.request`). The runner blocks until each is answered, so they queue;
 * the {@link AskSheet} shows the first one for the active workspace and the
 * next surfaces once it's answered.
 */

let asks: ReadonlyArray<AskRequest> = Object.freeze([]);
const resolvedIds = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export const askStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getAll(): ReadonlyArray<AskRequest> {
    return asks;
  },
  add(req: AskRequest): void {
    if (resolvedIds.has(req.requestId)) return;
    if (asks.some((a) => a.requestId === req.requestId)) return;
    asks = Object.freeze([...asks, req]);
    emit();
  },
  addWorkflow(req: AskRequest): void {
    const runId = req.workflow?.runId;
    if (req.kind !== 'workflow' || !runId) {
      if (resolvedIds.has(req.requestId)) return;
      if (asks.some((a) => a.requestId === req.requestId)) return;
      asks = Object.freeze([...asks, req]);
      emit();
      return;
    }
    if (resolvedIds.has(req.requestId)) return;
    const removed = asks.filter((a) => a.kind === 'workflow' && a.workflow?.runId === runId);
    if (removed.length === 0 && asks.some((a) => a.requestId === req.requestId)) return;
    for (const ask of removed) resolvedIds.add(ask.requestId);
    asks = Object.freeze([...asks.filter((a) => a.kind !== 'workflow' || a.workflow?.runId !== runId), req]);
    emit();
  },
  resolve(requestId: string): void {
    resolvedIds.add(requestId);
    if (!asks.some((a) => a.requestId === requestId)) return;
    asks = Object.freeze(asks.filter((a) => a.requestId !== requestId));
    emit();
  },
  resolveWorkflowRun(runId: string): void {
    const removed = asks.filter((a) => a.kind === 'workflow' && a.workflow?.runId === runId);
    if (removed.length === 0) return;
    for (const ask of removed) resolvedIds.add(ask.requestId);
    asks = Object.freeze(asks.filter((a) => a.kind !== 'workflow' || a.workflow?.runId !== runId));
    emit();
  },
  /**
   * Send the user's decision back to the runner and drop the ask.
   *
   * Drops optimistically (so the sheet advances immediately) but re-inserts
   * the ask if the IPC round-trip fails: the runner blocks parked on the ask
   * until `ask.respond` lands, so silently swallowing a transport/handler
   * failure would strand the turn forever with no way to re-answer.
   */
  respond(requestId: string, response: AskResponse): void {
    const pending = asks.find((a) => a.requestId === requestId);
    if (!pending) return;
    resolvedIds.add(requestId);
    asks = Object.freeze(asks.filter((a) => a.requestId !== requestId));
    emit();
    const send =
      pending.kind === 'workflow' && pending.workflow
        ? api()
            .invoke('workflows.resume', { runId: pending.workflow.runId, reply: response.text ?? '' })
            .then((result) => {
              if (!result.ok) throw new Error(result.error ?? 'Workflow did not resume.');
            })
        : api().invoke('ask.respond', { requestId, response });
    void send
      .catch((e: unknown) => {
        // Re-surface the ask so the user can retry instead of a wedged turn.
        resolvedIds.delete(requestId);
        if (!asks.some((a) => a.requestId === requestId)) {
          asks = Object.freeze([...asks, pending]);
          emit();
        }
        // Best-effort diagnostic (this package is DOM-/Node-global-free).
        (globalThis as { console?: { error(...args: unknown[]): void } }).console?.error(
          pending.kind === 'workflow'
            ? '[askStore] workflows.resume failed; re-surfacing workflow ask'
            : '[askStore] ask.respond failed; re-surfacing ask',
          e,
        );
      });
  },
};

/** Subscribe the store to incoming `ask.request` events. Call once at boot. */
export function wireAskBridge(): () => void {
  const offRequest = api().subscribe('ask.request', (req: AskRequest) => askStore.add(req));
  const offResolved = api().subscribe('ask.resolved', ({ requestId }) => {
    askStore.resolve(requestId);
  });
  const offWorkflow = api().subscribe('runner.event', ({ workspaceId, event }) => {
    const ask = workflowAskFromEvent(workspaceId, event);
    if (ask) {
      askStore.addWorkflow(ask);
      return;
    }
    const runId = workflowClearedRunId(event);
    if (runId) askStore.resolveWorkflowRun(runId);
  });
  return () => {
    offRequest();
    offResolved();
    offWorkflow();
  };
}

/** First pending ask for a workspace, or null. */
export function useActiveAsk(workspaceId: string | null): AskRequest | null {
  const all = useSyncExternalStore(askStore.subscribe, askStore.getAll);
  if (!workspaceId) return null;
  return all.find((a) => a.workspaceId === workspaceId) ?? null;
}

interface WorkflowPausePayload {
  runId?: unknown;
  stepId?: unknown;
  workflow?: unknown;
  label?: unknown;
  prompt?: unknown;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function workflowAskFromEvent(workspaceId: string, event: MoxxyEvent): AskRequest | null {
  if (event.type !== 'plugin_event' || event.subtype !== 'workflow_paused') return null;
  const payload = (event.payload ?? {}) as WorkflowPausePayload;
  const runId = str(payload.runId);
  if (!runId) return null;
  const stepId = str(payload.stepId);
  const requestId = `workflow:${runId}:${stepId || 'step'}:${event.seq}`;
  return {
    requestId,
    workspaceId,
    kind: 'workflow',
    workflow: {
      runId,
      workflow: str(payload.workflow, 'workflow'),
      stepId,
      label: str(payload.label, stepId || 'Workflow input'),
      prompt: str(payload.prompt),
    },
  };
}

function workflowClearedRunId(event: MoxxyEvent): string | null {
  if (event.type !== 'plugin_event') return null;
  if (event.subtype !== 'workflow_resumed' && event.subtype !== 'workflow_failed' && event.subtype !== 'workflow_completed') {
    return null;
  }
  const runId = (event.payload as { runId?: unknown } | undefined)?.runId;
  return typeof runId === 'string' && runId.length > 0 ? runId : null;
}
