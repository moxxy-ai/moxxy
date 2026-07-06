import { describe, expect, it } from 'vitest';
import { CollaborationState, pathsConflict } from './state.js';
import type { CollabEvent, RosterEntry } from './hub-types.js';
import { assertDefined } from '@moxxy/sdk';

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

  it('does not drop a same-millisecond message that lands after the cursor advanced', () => {
    // The live awareness loop polls inbox(lastInboxTs) and advances
    // lastInboxTs to the max ts seen. With strict `>` a message sharing that
    // exact ms is silently never delivered. Pin the clock to one ms.
    let clock = 1000;
    const state = new CollaborationState({ task: 't', roster, now: () => clock });
    state.post('backend', 'all', 'first'); // ts 1000
    let lastTs = 0;
    let fresh = state.inbox('tests', lastTs);
    expect(fresh.map((m) => m.body)).toEqual(['first']);
    lastTs = Math.max(lastTs, ...fresh.map((m) => m.ts)); // 1000

    // A second message posted in the SAME ms, after the cursor advanced.
    state.post('backend', 'all', 'second'); // ts 1000
    fresh = state.inbox('tests', lastTs);
    expect(fresh.map((m) => m.body)).toEqual(['second']); // delivered, not dropped

    // Idempotent: re-polling at the same cursor returns nothing.
    expect(state.inbox('tests', lastTs)).toEqual([]);

    // And a later-ms message still arrives.
    clock = 1001;
    state.post('backend', 'all', 'third');
    expect(state.inbox('tests', lastTs).map((m) => m.body)).toEqual(['third']);
  });

  it('bounds retained history but never loses an undrained message', () => {
    // Single-agent roster so the only reader is the one we drain — its drained
    // prefix becomes safe to evict, exercising the bounded path.
    const solo: RosterEntry[] = [{ id: 'tests', name: 'Tests', role: 'implementer', subtask: 'x' }];
    const state = new CollaborationState({ task: 't', roster: solo, now: () => Date.now() });
    for (let i = 0; i < 6000; i++) state.post('backend', 'tests', `m${i}`);
    // tests has never drained → nothing it is owed was dropped: a full drain
    // yields every message in order.
    const drained = state.inbox('tests');
    expect(drained.map((m) => m.body)).toEqual(
      Array.from({ length: 6000 }, (_, i) => `m${i}`),
    );
    // After draining, the consumed prefix is evictable; another flood stays
    // bounded yet the next drain still returns exactly the new messages.
    for (let i = 6000; i < 12000; i++) state.post('backend', 'tests', `m${i}`);
    expect(state.allMessages().length).toBeLessThanOrEqual(6000);
    const next = state.inbox('tests');
    expect(next[0]?.body).toBe('m6000');
    expect(next[next.length - 1]?.body).toBe('m11999');
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

  it('frees a failed agent\'s locks so survivors can claim its paths', () => {
    const { state, events } = mkState();
    expect(state.boardClaim('backend', ['src/api']).ok).toBe(true);
    // backend's turn ended without collab_done → reported 'failed'.
    state.setStatus('backend', 'failed', 'turn ended without calling collab_done');
    // its exclusive lease is released (like a crash), so a survivor can take over.
    expect(state.boardClaim('tests', ['src/api/routes.ts']).ok).toBe(true);
    expect(events.some((e) => e.kind === 'board' && e.action === 'release')).toBe(true);
  });

  it('does not let a non-owner release another agent\'s claim by id', () => {
    const { state } = mkState();
    const claim = state.boardClaim('backend', ['src/api']);
    expect(claim.ok).toBe(true);
    const id = claim.ok ? claim.item.id : '';

    // tests tries to release backend's lock by its (publicly visible) id
    state.boardRelease('tests', { id });
    // the lock must still be held by backend
    const clash = state.boardClaim('tests', ['src/api/routes.ts']);
    expect(clash).toEqual({ ok: false, ownedBy: 'backend', paths: ['src/api/routes.ts'] });

    // the rightful owner can still release it
    state.boardRelease('backend', { id });
    expect(state.boardClaim('tests', ['src/api/routes.ts']).ok).toBe(true);
  });

  it('does not let a non-owner hijack another agent\'s board item by id', () => {
    const { state } = mkState();
    const claim = state.boardClaim('backend', ['src/api']);
    expect(claim.ok).toBe(true);
    const id = claim.ok ? claim.item.id : '';

    // tests tries to reassign backend's item to itself with non-overlapping paths
    const hijack = state.boardClaim('tests', ['src/other'], id);
    expect(hijack.ok).toBe(false);

    // backend must still own both the item and src/api
    const item = state.boardItems().find((it) => it.id === id);
    expect(item?.owner).toBe('backend');
    expect(item?.paths).toEqual(['src/api']);
    expect(state.boardClaim('tests', ['src/api']).ok).toBe(false);
  });

  it('releases a crashed agent\'s claims so survivors can proceed', () => {
    const { state, events } = mkState();
    expect(state.boardClaim('backend', ['src/api']).ok).toBe(true);

    // backend's process dies → coordinator marks it crashed
    state.setStatus('backend', 'crashed');

    // a crashed owner must not hold the lock forever
    expect(state.boardClaim('tests', ['src/api/routes.ts']).ok).toBe(true);
    // and a release event was emitted for observers
    expect(events.some((e) => e.kind === 'board' && e.action === 'release')).toBe(true);
  });

  it('never mints a NEW item under a caller-supplied id (no auto-counter clobber)', () => {
    const { state } = mkState();
    // A peer pre-creates an item with the guessable id 't5' while boardSeq is 0.
    const pre = state.boardClaim('backend', ['src/a'], 't5');
    expect(pre.ok).toBe(true);
    // It must NOT have squatted the auto id — caller ids and auto ids are
    // disjoint namespaces, so a later auto-claim can't overwrite it.
    expect(pre.ok && pre.item.id).not.toBe('t5');

    // Five auto-claims (would have produced 't5') must not clobber backend's lock.
    for (const p of ['src/b', 'src/c', 'src/d', 'src/e', 'src/f']) {
      expect(state.boardClaim('tests', [p]).ok).toBe(true);
    }
    // backend still owns src/a.
    const clash = state.boardClaim('tests', ['src/a']);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.ownedBy).toBe('backend');
  });

  it('rejects a NEW claim with no usable paths (no junk pathless lock)', () => {
    const { state, events } = mkState();
    // The hub force-casts a malformed RPC to []; a NEW claim must not mint a
    // pathless lock item that locks nothing and pollutes the board.
    const empty = state.boardClaim('backend', []);
    expect(empty.ok).toBe(false);
    expect(state.boardItems()).toHaveLength(0);
    expect(events.some((e) => e.kind === 'board')).toBe(false);

    // Paths that collapse to nothing after normalization are likewise rejected.
    const dupOnly = state.boardClaim('backend', ['src/a', './src/a', 'src/a/']);
    // (these are NOT empty — they normalize to one real path — so this succeeds)
    expect(dupOnly.ok).toBe(true);
    if (dupOnly.ok) expect(dupOnly.item.paths).toEqual(['src/a']); // de-duped on create
  });

  it('re-claiming an existing item with empty paths is a harmless status touch', () => {
    const { state } = mkState();
    const first = state.boardClaim('backend', ['src/a']);
    expect(first.ok).toBe(true);
    const id = first.ok ? first.item.id : '';
    // An empty re-claim of an EXISTING owned item must not drop its paths.
    const touched = state.boardClaim('backend', [], id);
    expect(touched.ok).toBe(true);
    if (touched.ok) expect(touched.item.paths).toEqual(['src/a']);
    expect(state.boardClaim('tests', ['src/a']).ok).toBe(false); // still locked
  });

  it('re-claiming an item merges paths rather than dropping the old lock', () => {
    const { state } = mkState();
    const first = state.boardClaim('backend', ['src/a']);
    expect(first.ok).toBe(true);
    const id = first.ok ? first.item.id : '';

    // Re-claim the SAME item with a different path — the old path must survive.
    const second = state.boardClaim('backend', ['src/b'], id);
    expect(second.ok).toBe(true);
    if (second.ok) {
      assertDefined(second.item.paths, 'a successful claim always records the claimed paths');
      expect([...second.item.paths].sort()).toEqual(['src/a', 'src/b']);
    }

    // Another agent still cannot take src/a (its lock was not silently dropped).
    expect(state.boardClaim('tests', ['src/a']).ok).toBe(false);
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

  it('refuses a unilateral commit from an unauthorized or un-agreed caller', () => {
    const { state } = mkState();
    const c = state.contractPublish('architect', {
      title: 'AuthService',
      spec: 'login(user): Token',
      owner: 'backend',
      consumers: ['tests'],
    });

    // A consumer that is neither the owner nor the architect cannot rewrite it,
    // even with no change in flight — the propose→ack protocol is enforced.
    expect(state.contractUpdate('tests', c.id, 'login(user, hax): Token')).toBeNull();
    expect(state.contractList().find((e) => e.id === c.id)?.spec).toBe('login(user): Token');

    // A proposed-but-not-yet-agreed change cannot be force-committed by anyone.
    state.contractProposeChange('tests', c.id, 'login(user, opts): Token', 'need opts');
    expect(state.contractUpdate('architect', c.id, 'login(user, opts): Token')).toBeNull();

    // Once owner + all consumers agree, the architect (or owner) may commit.
    expect(state.contractAckChange('backend', c.id)?.agreed).toBe(true);
    const committed = state.contractUpdate('backend', c.id, 'login(user, opts): Token');
    expect(committed?.version).toBe(2);
    expect(committed?.status).toBe('changed');
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

  it('emits an event when a teammate is added after construction', () => {
    const { state, events } = mkState();
    state.addAgent({ id: 'designer', name: 'Designer', role: 'designer', subtask: 'ux' });
    // Live peers learn of the new teammate off the event stream (no re-poll).
    expect(
      events.some((e) => e.kind === 'agent_status' && e.agentId === 'designer'),
    ).toBe(true);
    expect(state.rosterView().agents.map((a) => a.id)).toContain('designer');
    // a duplicate add is still a silent no-op (no second event)
    state.addAgent({ id: 'designer', name: 'Designer', role: 'designer', subtask: 'ux' });
    expect(events.filter((e) => e.kind === 'agent_status' && e.agentId === 'designer')).toHaveLength(1);
  });
});
