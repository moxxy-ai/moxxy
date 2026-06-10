/**
 * Workflows handlers.
 *
 * Thin pass-throughs to the runner session's optional `workflows`
 * view (present only when the workflows plugin is loaded). list /
 * setEnabled degrade gracefully when the plugin is absent; run throws
 * a clear error so the renderer can surface it.
 */

import type { RunnerPool } from '../runner-pool';
import { handle, mustSession } from './shared';

export function registerWorkflowsHandlers(pool: RunnerPool): void {
  // ---- Workflows -----------------------------------------------------------

  handle('workflows.list', async () => {
    const session = mustSession(pool);
    const view = session.workflows;
    if (!view) return [];
    return await view.list();
  });
  handle('workflows.setEnabled', async ({ name, enabled }) => {
    const session = mustSession(pool);
    if (session.workflows) await session.workflows.setEnabled(name, enabled);
  });
  handle('workflows.run', async ({ name }) => {
    const session = mustSession(pool);
    if (!session.workflows) throw new Error('workflows plugin not loaded');
    return await session.workflows.run(name);
  });

  // ---- Visual builder (phase 2) -------------------------------------------
  // Optional on the view, so feature-check before delegating; throw a clear
  // error when the host can't serve the builder yet.
  handle('workflows.validateDraft', async ({ yaml }) => {
    const session = mustSession(pool);
    if (!session.workflows?.validateDraft) throw new Error('workflows builder not supported on this session');
    return await session.workflows.validateDraft(yaml);
  });
  handle('workflows.save', async ({ yaml, previousName }) => {
    const session = mustSession(pool);
    if (!session.workflows?.save) throw new Error('workflows builder not supported on this session');
    return await session.workflows.save(yaml, previousName);
  });
  handle('workflows.getRun', async ({ name }) => {
    const session = mustSession(pool);
    if (!session.workflows?.getRun) throw new Error('workflows builder not supported on this session');
    return await session.workflows.getRun(name);
  });

  // ---- Human-in-the-loop: resume a paused awaitInput run ------------------
  // Optional on the view (older hosts lack it). When the session is a
  // RemoteSession, its client view gates this on the runner's protocol (>= 5)
  // and surfaces the "update the CLI" error.
  handle('workflows.resume', async ({ runId, reply }) => {
    const session = mustSession(pool);
    if (!session.workflows?.resume) throw new Error('workflow resume not supported on this session');
    return await session.workflows.resume(runId, reply);
  });
}
