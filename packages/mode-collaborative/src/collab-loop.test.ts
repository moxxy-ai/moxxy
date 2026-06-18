import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModeContext, MoxxyEvent } from '@moxxy/sdk';
import type { CollaborationHub } from '@moxxy/plugin-collab';
import { runCollaborative, sleep, type CollabDeps } from './collab-loop.js';
import { resolveCollabConfig } from './config.js';
import type { Supervisor } from './peer-supervisor.js';
import { git } from './worktrees.js';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const cleanups: Array<() => void> = [];

beforeEach(() => {
  // Isolate the global single-flight lock to a temp file so the e2e runs never
  // touch (or get blocked by) a real ~/.moxxy collaboration lock.
  const lockDir = mkdtempSync(join(tmpdir(), 'mc-loop-lock-'));
  process.env.MOXXY_COLLAB_LOCK = join(lockDir, 'active.lock');
  cleanups.push(() => {
    delete process.env.MOXXY_COLLAB_LOCK;
    rmSync(lockDir, { recursive: true, force: true });
  });
});

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mc-loop-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await git(dir, ['init', '-b', 'main']);
  writeFileSync(join(dir, 'README.md'), '# base\n');
  await git(dir, ['add', '-A']);
  await git(dir, [...IDENT, 'commit', '-m', 'base']);
  return dir;
}

function fakeCtx(): { ctx: ModeContext; events: MoxxyEvent[] } {
  const events: MoxxyEvent[] = [];
  const ctx = {
    sessionId: 'sess-collabtest',
    turnId: 'turn-collabtest',
    signal: new AbortController().signal,
    emit: async (e: MoxxyEvent) => {
      events.push(e);
      return e;
    },
    log: {
      slice: () => [
        { type: 'user_prompt', text: 'build the thing', sessionId: 's', turnId: 't', source: 'user' },
      ],
    },
  } as unknown as ModeContext;
  return { ctx, events };
}

/** A supervisor that simulates real agents by driving the hub + filesystem
 *  (no child processes, no LLM) — the architect writes the roster + contracts,
 *  implementers write their owned files and mark done. */
function fakeSupervisor(hub: CollaborationHub): Supervisor {
  return {
    spawn({ entry, cwd }) {
      if (entry.role === 'architect') {
        mkdirSync(join(cwd, '.moxxy-collab'), { recursive: true });
        writeFileSync(join(cwd, '.moxxy-collab', 'CONTRACTS.md'), '# Contracts\n\n- API: doThing(): void\n');
        writeFileSync(
          join(cwd, '.moxxy-collab', 'roster.json'),
          JSON.stringify([
            { id: 'backend', name: 'Backend', role: 'implementer', subtask: 'build the API', ownedPaths: ['api.ts'] },
            { id: 'tests', name: 'Tests', role: 'implementer', subtask: 'write tests', ownedPaths: ['api.test.ts'] },
          ]),
        );
        hub.state.contractPublish('architect', { title: 'API', spec: 'doThing(): void', owner: 'backend', consumers: ['tests'] });
        hub.post('architect', 'all', 'Contracts published — go build.');
        hub.state.markDone('architect', 'design + contracts done');
      } else {
        const file = entry.id === 'backend' ? 'api.ts' : 'api.test.ts';
        writeFileSync(join(cwd, file), `// ${entry.id}\nexport const ${entry.id} = true;\n`);
        hub.state.boardClaim(entry.id, [file]);
        hub.state.markDone(entry.id, `${entry.id} implemented ${file}`);
      }
      return { socket: 'fake.sock' };
    },
    stop: async () => undefined,
    shutdownAll: async () => undefined,
    stderrOf: () => [],
    hasExited: () => false,
  };
}

/** Like {@link fakeSupervisor}, but `failingId` is spawned and then reports its
 *  process exited WITHOUT ever marking done — simulating a crash / a turn that
 *  ended without collab_done. Exercises the coordinator's fail-fast path. */
function partiallyFailingSupervisor(hub: CollaborationHub, failingId: string): Supervisor {
  const exited = new Set<string>();
  return {
    spawn({ entry, cwd }) {
      if (entry.role === 'architect') {
        mkdirSync(join(cwd, '.moxxy-collab'), { recursive: true });
        writeFileSync(join(cwd, '.moxxy-collab', 'CONTRACTS.md'), '# Contracts\n');
        writeFileSync(
          join(cwd, '.moxxy-collab', 'roster.json'),
          JSON.stringify([
            { id: 'backend', name: 'Backend', role: 'implementer', subtask: 'build the API', ownedPaths: ['api.ts'] },
            { id: 'flaky', name: 'Flaky', role: 'implementer', subtask: 'a doomed task', ownedPaths: ['flaky.ts'] },
          ]),
        );
        hub.state.markDone('architect', 'design done');
      } else if (entry.id === failingId) {
        // No file, no done — the process simply dies.
        exited.add(entry.id);
      } else {
        const file = `${entry.id}.ts`;
        writeFileSync(join(cwd, file), `export const ${entry.id} = true;\n`);
        hub.state.boardClaim(entry.id, [file]);
        hub.state.markDone(entry.id, `${entry.id} done`);
      }
      return { socket: 'fake.sock' };
    },
    stop: async () => undefined,
    shutdownAll: async () => undefined,
    stderrOf: () => ['boom: simulated crash'],
    hasExited: (id) => exited.has(id),
  };
}

describe('collaborative coordinator (end-to-end, fake agents + real git)', () => {
  it('runs architect → roster → parallel implementers → merge → synthesize', async () => {
    const repo = await initRepo();
    const { ctx, events } = fakeCtx();
    const deps: CollabDeps = {
      cwd: repo,
      config: resolveCollabConfig(undefined, { requireRosterApproval: false }),
      createSupervisor: (_opts, hub) => fakeSupervisor(hub),
    };

    for await (const _ of runCollaborative(ctx, deps)) void _;

    const subtypes = events
      .filter((e) => e.type === 'plugin_event')
      .map((e) => (e as { subtype: string }).subtype);

    // orchestration milestones fired in order
    expect(subtypes).toContain('collab_started');
    expect(subtypes).toContain('collab_roster_proposed');
    expect(subtypes).toContain('collab_roster_confirmed');
    expect(subtypes).toContain('collab_completed');
    // the contract the architect published was relayed to the user log
    expect(subtypes).toContain('collab_contract_published');
    // a teammate message was relayed
    expect(subtypes).toContain('collab_message');

    // BOTH implementers' work was integrated into the user's branch
    expect(existsSync(join(repo, 'api.ts'))).toBe(true);
    expect(existsSync(join(repo, 'api.test.ts'))).toBe(true);
    // the agreed contracts landed too
    expect(existsSync(join(repo, '.moxxy-collab', 'CONTRACTS.md'))).toBe(true);

    // final synthesis names both agents
    const finalMsg = events.filter((e) => e.type === 'assistant_message').pop() as { content: string } | undefined;
    expect(finalMsg?.content).toContain('backend');
    expect(finalMsg?.content).toContain('tests');
  });

  it('does NOT hang on a failed agent: surfaces it and completes with the others', async () => {
    const repo = await initRepo();
    const { ctx, events } = fakeCtx();
    const deps: CollabDeps = {
      cwd: repo,
      config: resolveCollabConfig(undefined, { requireRosterApproval: false, wallClockMs: 60_000 }),
      createSupervisor: (_opts, hub) => partiallyFailingSupervisor(hub, 'flaky'),
    };

    // The whole run must finish well under the wall-clock (the old code would
    // have polled the full 60s for the never-done 'flaky' agent).
    const started = Date.now();
    for await (const _ of runCollaborative(ctx, deps)) void _;
    expect(Date.now() - started).toBeLessThan(20_000);

    const subtypes = events
      .filter((e) => e.type === 'plugin_event')
      .map((e) => (e as { subtype: string }).subtype);
    // The failed agent was surfaced, not silently swallowed.
    expect(subtypes).toContain('collab_agent_failed');
    expect(subtypes).toContain('collab_completed');

    const failed = events.find(
      (e) => (e as { subtype?: string }).subtype === 'collab_agent_failed',
    ) as { payload: { id: string; stderr: ReadonlyArray<string> } };
    expect(failed.payload.id).toBe('flaky');
    expect(failed.payload.stderr.join('\n')).toContain('simulated crash');

    // The healthy agent's work still integrated; the completion counts 1/2 done.
    expect(existsSync(join(repo, 'backend.ts'))).toBe(true);
    const completed = events.find(
      (e) => (e as { subtype?: string }).subtype === 'collab_completed',
    ) as { payload: { done: string[]; total: number } };
    expect(completed.payload.done).toEqual(['backend']);
    expect(completed.payload.total).toBe(2);
  });

  it('falls back to sequential when the workspace is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-nogit-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const { ctx, events } = fakeCtx();
    const deps: CollabDeps = {
      cwd: dir,
      config: resolveCollabConfig(undefined, { requireRosterApproval: false }),
      createSupervisor: (_opts, hub) => fakeSupervisor(hub),
    };

    for await (const _ of runCollaborative(ctx, deps)) void _;

    const subtypes = events
      .filter((e) => e.type === 'plugin_event')
      .map((e) => (e as { subtype: string }).subtype);
    expect(subtypes).toContain('collab_fallback_sequential');
    expect(subtypes).toContain('collab_completed');
    // sequential edits land directly in the shared workspace
    expect(existsSync(join(dir, 'api.ts'))).toBe(true);
    expect(existsSync(join(dir, 'api.test.ts'))).toBe(true);
  });
});

describe('sleep (poll helper)', () => {
  it('does not leak abort listeners on the normal-timeout path', async () => {
    // A collaboration polls every ~500ms for up to its wall-clock guard
    // (30 min default) — thousands of sleeps on ONE long-lived signal. A leak
    // here means a MaxListenersExceededWarning + unbounded listener growth.
    const ac = new AbortController();
    for (let i = 0; i < 20; i++) await sleep(0, ac.signal);
    expect(getEventListeners(ac.signal, 'abort').length).toBe(0);
  });

  it('still resolves and cleans up when aborted mid-sleep', async () => {
    const ac = new AbortController();
    const p = sleep(10_000, ac.signal);
    ac.abort();
    await p; // resolves immediately on abort rather than waiting out the timer
    expect(getEventListeners(ac.signal, 'abort').length).toBe(0);
  });
});
