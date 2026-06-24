/**
 * Workflows handlers.
 *
 * Thin pass-throughs to the runner session's optional `workflows`
 * view (present only when the workflows plugin is loaded). list /
 * setEnabled degrade gracefully when the plugin is absent; run throws
 * a clear error so the renderer can surface it.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { RunnerPool } from '../runner-pool';
import type { DeskStore } from '../desks';
import { buildSessionNameResolver, handle, mustSession } from './shared';

export function registerWorkflowsHandlers(pool: RunnerPool, desks?: DeskStore): void {
  // ---- Workflows -----------------------------------------------------------

  handle('workflows.list', async () => {
    const session = mustSession(pool);
    const view = session.workflows;
    if (!view) return [];
    const [summaries, resolveName] = await Promise.all([view.list(), buildSessionNameResolver(desks)]);
    // The runner-side view carries `targetSessionId` (read from the YAML); the
    // host adds the resolved display name (it owns the desk registry).
    return summaries.map((s) => {
      const targetSessionId = s.targetSessionId ?? null;
      return { ...s, targetSessionId, targetSessionName: resolveName(targetSessionId) };
    });
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

  // Reassign a workflow's target session by flipping the top-level
  // `targetSessionId` key in its YAML and re-saving via the existing builder
  // save path (no new runner RPC). The edit is a single-key set/delete on the
  // parsed object — `view.save` re-parses + schema-validates server-side. We use
  // the pure `yaml` lib (not `@moxxy/plugin-workflows`, whose static import would
  // drag the engine + eager `ulid` into the bundled Electron main and crash boot).
  handle('workflows.setTargetSession', async ({ name, sessionId }) => {
    const session = mustSession(pool);
    const view = session.workflows;
    if (!view?.getRun || !view?.save) throw new Error('workflows builder not supported on this session');
    const detail = await view.getRun(name);
    if (!detail) return null;
    const obj = (parseYaml(detail.yaml) ?? {}) as Record<string, unknown>;
    if (sessionId) obj.targetSessionId = sessionId;
    else delete obj.targetSessionId;
    // lineWidth:0 matches the plugin's canonical serializer (no long-line wraps).
    await view.save(stringifyYaml(obj, { lineWidth: 0 }), name);
    const [summaries, resolveName] = await Promise.all([view.list(), buildSessionNameResolver(desks)]);
    const updated = summaries.find((s) => s.name === name);
    if (!updated) return null;
    const targetSessionId = updated.targetSessionId ?? null;
    return { ...updated, targetSessionId, targetSessionName: resolveName(targetSessionId) };
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
