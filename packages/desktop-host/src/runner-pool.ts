/**
 * RunnerPool — one supervised `moxxy serve` per workspace.
 *
 * Each workspace gets its own unix socket so cwds don't collide and
 * runs concurrently: a long turn in workspace A keeps streaming while
 * the user types in workspace B. Switching workspaces in the sidebar
 * never tears down the other runner — it just changes which one the
 * UI is foregrounding.
 *
 * One pool instance lives in the main process for the lifetime of the
 * app. Closing the app calls {@link stopAll}, which fans out to every
 * supervisor.
 */

import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import path from 'node:path';

import { platformSocket } from '@moxxy/runner';

import { RunnerSupervisor } from './runner-supervisor';
import { seedChatIntoSession } from './chat-log';

/** Workspace id used for the "no workspace bound" runner. Stable across
 *  runs so the same socket is reused. */
export const UNBOUND_ID = '__unbound__';

interface Entry {
  readonly id: string;
  readonly supervisor: RunnerSupervisor;
}

export class RunnerPool extends EventEmitter {
  private entries = new Map<string, Entry>();
  private activeId: string | null = null;

  /**
   * Return (creating if needed) the supervisor bound to the given
   * workspace. `cwd === null` is reserved for the unbound runner.
   * Calling this on a workspace whose cwd has changed updates the
   * supervisor in place — its run loop will tear down and respawn.
   */
  async getOrCreate(id: string, cwd: string | null): Promise<RunnerSupervisor> {
    const existing = this.entries.get(id);
    if (existing) {
      await existing.supervisor.setCwd(cwd);
      return existing.supervisor;
    }
    const socketPath = socketFor(id);
    // Migrate a legacy / localStorage-only chat into the runner's authoritative
    // log BEFORE the runner resumes this session id, so the runner owns its full
    // history (else continuing the chat would strand the old history in the
    // NDJSON mirror). Idempotent + non-destructive — skips a session the runner
    // already owns and leaves the NDJSON file intact. Best-effort: a failed seed
    // must not block opening the workspace (NDJSON stays the read fallback).
    try {
      await seedChatIntoSession(id);
    } catch {
      /* best-effort migration; the NDJSON read fallback still covers this chat */
    }
    // Pass the workspace id as the runner's sticky session id so each
    // workspace resumes its own conversation + model context across app
    // restarts (the runner persists to ~/.moxxy/sessions/<id>.jsonl and
    // resumes it next launch) instead of booting an empty session every time.
    const supervisor = new RunnerSupervisor(socketPath, id);
    if (cwd) await supervisor.setCwd(cwd);
    this.entries.set(id, { id, supervisor });
    // Forward every supervisor's change event upward, tagged with the
    // workspace id, so the IPC layer can fan out to the renderer with
    // a per-workspace routing key.
    supervisor.on('change', () => this.emit('change', id));
    void supervisor.run();
    if (this.activeId === null) this.activeId = id;
    return supervisor;
  }

  /** Mark a workspace as foregrounded — the chat view follows it. */
  setActive(id: string): void {
    if (!this.entries.has(id)) {
      throw new Error(`RunnerPool.setActive: unknown workspace ${id}`);
    }
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit('active', id);
  }

  /** Currently-foregrounded workspace, or null. */
  active(): RunnerSupervisor | null {
    if (!this.activeId) return null;
    return this.entries.get(this.activeId)?.supervisor ?? null;
  }

  activeWorkspaceId(): string | null {
    return this.activeId;
  }

  /** Lookup by id without auto-creation. */
  get(id: string): RunnerSupervisor | null {
    return this.entries.get(id)?.supervisor ?? null;
  }

  list(): ReadonlyArray<{ id: string; supervisor: RunnerSupervisor }> {
    return Array.from(this.entries.values()).map((e) => ({
      id: e.id,
      supervisor: e.supervisor,
    }));
  }

  /** Stop & forget one workspace's runner. Safe to call during
   *  workspace deletion. */
  async remove(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (this.activeId === id) {
      const next = this.entries.keys().next();
      this.activeId = next.done ? null : next.value;
      if (this.activeId) this.emit('active', this.activeId);
    }
    await entry.supervisor.stop().catch(() => undefined);
    entry.supervisor.removeAllListeners();
  }

  /** Tear down every supervised runner. Awaited from `before-quit`. */
  async stopAll(): Promise<void> {
    const all = Array.from(this.entries.values());
    this.entries.clear();
    this.activeId = null;
    await Promise.all(
      all.map((e) =>
        e.supervisor
          .stop()
          .catch(() => undefined)
          .finally(() => e.supervisor.removeAllListeners()),
      ),
    );
  }
}

/**
 * Per-workspace socket path. Unbound runner keeps the legacy
 * `~/.moxxy/serve.sock` path so external tools (TUI, `moxxy attach`)
 * keep working when the user hasn't bound a workspace yet.
 */
export function socketFor(id: string, platform: NodeJS.Platform = process.platform): string {
  // platformSocket() owns the unix-path-vs-Windows-named-pipe split (a raw
  // .sock path can't be bound on Windows). The unbound runner derives the same
  // address as the runner's own default (runnerSocketPath) so an external
  // `moxxy tui` / attach still finds it; bound workspaces get a distinct one.
  if (id === UNBOUND_ID) {
    return (
      process.env.MOXXY_RUNNER_SOCKET ??
      platformSocket('serve', path.join(homedir(), '.moxxy', 'serve.sock'), platform)
    );
  }
  // Workspace-bound sockets sit under ~/.moxxy/desktop/sockets/ on unix so a
  // single deleted workspace's stale .sock doesn't pollute the home dir's top
  // level; on Windows they become `\\.\pipe\moxxy-serve-<id>`.
  return platformSocket(
    `serve-${id}`,
    path.join(homedir(), '.moxxy', 'desktop', 'sockets', `serve-${id}.sock`),
    platform,
  );
}
