/**
 * Real-process integration test for the collaboration peer.
 *
 * Unlike collab-loop.test.ts (which injects a fake supervisor), this spawns the
 * REAL `moxxy agent` child against a REAL hub over a unix socket — exercising
 * the spawn → boot → collab.register → terminal-status path end to end, with NO
 * LLM (the peer boots provider-less, so its turn ends immediately without
 * collab_done). It is the regression guard for the "30-minute hang": a peer
 * whose turn ends without collab_done MUST report a terminal status so the
 * coordinator stops waiting.
 *
 * Guarded: skips when the CLI bundle isn't built (the cli is a *dependent* of
 * this package, so a topological `^build` doesn't guarantee its dist exists);
 * runs locally and in any job that builds the cli first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollaborationHub, type CollaborationHub } from '@moxxy/plugin-collab';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(HERE, '../../cli/dist/bin.js');
const itIfBuilt = existsSync(CLI_BIN) ? it : it.skip;

const cleanups: Array<() => void> = [];
let child: ChildProcess | null = null;
afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
  }
  child = null;
  for (const fn of cleanups.splice(0)) fn();
});

function status(hub: CollaborationHub, id: string): string | undefined {
  return hub.state.rosterView().agents.find((a) => a.id === id)?.status;
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

describe('real moxxy agent peer process', () => {
  itIfBuilt(
    'spawns, registers with the hub, and reports a terminal status when its turn ends without collab_done',
    async () => {
      const runDir = mkdtempSync(join(tmpdir(), 'mc-peerproc-'));
      const home = mkdtempSync(join(tmpdir(), 'mc-peerproc-home-'));
      const cwd = mkdtempSync(join(tmpdir(), 'mc-peerproc-wt-'));
      cleanups.push(() => {
        for (const d of [runDir, home, cwd]) rmSync(d, { recursive: true, force: true });
      });

      const hub = await createCollaborationHub({
        socketPath: join(runDir, 'hub.sock'),
        task: 'integration probe',
        roster: [{ id: 'probe', name: 'Probe', role: 'implementer', subtask: 'noop' }],
      });
      cleanups.push(() => void hub.close());

      child = spawn(process.execPath, [CLI_BIN, 'agent'], {
        cwd,
        env: {
          ...process.env,
          MOXXY_HOME: home, // isolate from the developer's real ~/.moxxy + providers
          MOXXY_COLLAB_HUB: hub.socketPath,
          MOXXY_COLLAB_AGENT_ID: 'probe',
          MOXXY_COLLAB_ROLE: 'implementer',
          MOXXY_COLLAB_SUBTASK: 'noop probe',
          MOXXY_COLLAB_PARENT_TASK: 'integration probe',
          MOXXY_SESSION_ID: 'probe::probe',
          MOXXY_MODE: 'collab-peer',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      // 1) The real child boots and registers over the socket.
      const registered = await waitFor(() => {
        const s = status(hub, 'probe');
        return s !== undefined && s !== 'pending';
      }, 30_000);
      expect(registered, `agent never registered (status=${status(hub, 'probe')})`).toBe(true);

      // 2) Its provider-less turn ends without collab_done, so it must report a
      //    terminal status ('failed') instead of idling as 'connected' forever.
      const settled = await waitFor(() => {
        const s = status(hub, 'probe');
        return s === 'failed' || s === 'done' || s === 'crashed';
      }, 30_000);
      expect(settled, `agent never reached a terminal status (status=${status(hub, 'probe')})`).toBe(
        true,
      );
      expect(['failed', 'crashed']).toContain(status(hub, 'probe'));
    },
    70_000,
  );
});
