import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModeContext, MoxxyEvent } from '@moxxy/sdk';
import type { CollaborationHub } from '@moxxy/plugin-collab';
import { runCollaborative, type CollabDeps } from './collab-loop.js';
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
