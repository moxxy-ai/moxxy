import { describe, expect, it } from 'vitest';
import { CollaborationState, pathsConflict } from './state.js';
import type { CollabEvent, RosterEntry } from './hub-types.js';

const roster: RosterEntry[] = [
  { id: 'architect', name: 'Architect', role: 'architect', subtask: 'design' },
  { id: 'backend', name: 'Backend', role: 'implementer', subtask: 'api' },
  { id: 'tests', name: 'Tests', role: 'implementer', subtask: 'tests' },
];

function mkState(): { state: CollaborationState; events: CollabEvent[] } {
  const events: CollabEvent[] = [];
  let t = 1000;
  const state = new CollaborationState({
    task: 'build the thing',
    roster,
    now: () => ++t,
    emit: (e) => events.push(e),
  });
  return { state, events };
}

describe('pathsConflict', () => {
  it('detects equality and directory-prefix overlap', () => {
    expect(pathsConflict('src/a.ts', 'src/a.ts')).toBe(true);
    expect(pathsConflict('src/auth', 'src/auth/login.ts')).toBe(true);
    expect(pathsConflict('./src/auth/', 'src/auth')).toBe(true);
    expect(pathsConflict('src/a.ts', 'src/b.ts')).toBe(false);
    expect(pathsConflict('src/auth', 'src/authz.ts')).toBe(false);
  });
});

describe('messaging', () => {
  it('drains the inbox cursor and excludes the reader\'s own messages', () => {
    const { state } = mkState();
    state.post('backend', 'tests', 'please cover the API');
    state.post('backend', 'all', 'starting on the API');
    state.post('tests', 'tests', 'note to self'); // own message, excluded for tests

    const first = state.inbox('tests');
    expect(first.map((m) => m.body)).toEqual(['please cover the API', 'starting on the API']);
    // cursor advanced → nothing new
    expect(state.inbox('tests')).toEqual([]);

    state.post('architect', 'all', 'contracts published');
    expect(state.inbox('tests').map((m) => m.body)).toEqual(['contracts published']);
  });

  it('supports sinceTs filtering without advancing the cursor', () => {
    const { state } = mkState();
    const a = state.post('backend', 'all', 'a');
    state.post('backend', 'all', 'b');
    const since = state.inbox('tests', a.ts);
    expect(since.map((m) => m.body)).toEqual(['b']);
    // cursor untouched → a full drain still returns both
    expect(state.inbox('tests').map((m) => m.body)).toEqual(['a', 'b']);
  });
});

describe('board file locks', () => {
  it('grants an exclusive lease and rejects an overlapping claim', () => {
    const { state, events } = mkState();
    const ok = state.boardClaim('backend', ['src/api']);
    expect(ok.ok).toBe(true);

    const clash = state.boardClaim('tests', ['src/api/routes.ts']);
    expect(clash).toEqual({ ok: false, ownedBy: 'backend', paths: ['src/api/routes.ts'] });

    // a disjoint claim is fine
    expect(state.boardClaim('tests', ['test/api.test.ts']).ok).toBe(true);

    // releasing lets another agent claim
    state.boardRelease('backend', { paths: ['src/api'] });
    expect(state.boardClaim('tests', ['src/api/routes.ts']).ok).toBe(true);

    expect(events.some((e) => e.kind === 'board' && e.action === 'claim')).toBe(true);
  });
});

describe('contracts', () => {
  it('publishes, proposes a change, gathers acks, and commits', () => {
    const { state, events } = mkState();
    const c = state.contractPublish('architect', {
      title: 'AuthService',
      spec: 'login(user): Token',
      owner: 'backend',
      consumers: ['tests'],
    });
    expect(c.status).toBe('published');
    expect(c.version).toBe(1);

    state.contractProposeChange('tests', c.id, 'login(user, opts): Token', 'need options');
    const ack = state.contractAckChange('backend', c.id);
    expect(ack?.agreed).toBe(true); // owner=backend + consumers=[tests] (proposer auto-acks)

    const updated = state.contractUpdate('architect', c.id, 'login(user, opts): Token');
    expect(updated?.status).toBe('changed');
    expect(updated?.version).toBe(2);
    expect(updated?.pendingChange).toBeUndefined();

    expect(events.filter((e) => e.kind === 'contract').map((e) => (e as { action: string }).action)).toEqual([
      'published',
      'change_proposed',
      'changed',
    ]);
  });
});

describe('human step-in (control)', () => {
  it('pauses, resumes, and records directives in the roster view', () => {
    const { state, events } = mkState();
    expect(state.rosterView().control).toEqual({ paused: false });

    state.setControl({ paused: true });
    expect(state.rosterView().control.paused).toBe(true);

    state.setControl({ directive: 'pivot to the v2 API' });
    const ctrl = state.rosterView().control;
    expect(ctrl.directive).toBe('pivot to the v2 API');
    expect(ctrl.directiveTs).toBeGreaterThan(0);

    state.setControl({ paused: false });
    expect(state.rosterView().control.paused).toBe(false);

    expect(events.filter((e) => e.kind === 'control')).toHaveLength(3);
  });
});

describe('lifecycle', () => {
  it('tracks done + allDone, ignoring crashed agents', () => {
    const { state } = mkState();
    expect(state.allDone()).toBe(false);
    state.markDone('architect', 'design done');
    state.markDone('backend', 'api done');
    expect(state.allDone()).toBe(false);
    state.setStatus('tests', 'crashed');
    // architect + backend done, tests crashed → live agents all done
    expect(state.allDone()).toBe(true);
    expect(state.doneSummaries().map((d) => d.agentId)).toEqual(['architect', 'backend']);
  });
});
