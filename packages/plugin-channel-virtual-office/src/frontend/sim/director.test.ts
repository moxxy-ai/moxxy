import { describe, expect, it } from 'vitest';
import { OfficeDirector } from './director.js';
import { tileCenterPx } from './types.js';
import type { ActorSnapshot, SceneEffect, Vec2, Walkability, Zones } from './types.js';
import type { Rng } from './rng.js';

// ---------- synthetic office fixture -----------------------------------------
// 12×10 grid, all walkable except a wall line at y=4, x=2..8 (gaps on both
// sides). Offices up top, war room top-right, social corner bottom-left.

const W = 12;
const H = 10;

function makeWalkable(): Walkability {
  const g = Array.from({ length: H }, () => Array.from({ length: W }, () => true));
  for (let x = 2; x <= 8; x++) g[4][x] = false;
  return g;
}

const ZONES: Zones = {
  offices: [
    {
      index: 0,
      door: { x: 2, y: 2 },
      seat: { tile: { x: 3, y: 2 }, facing: 'up' },
      monitorTile: { x: 3, y: 1 },
    },
    {
      index: 1,
      door: { x: 5, y: 2 },
      seat: { tile: { x: 6, y: 2 }, facing: 'up' },
      monitorTile: { x: 6, y: 1 },
    },
  ],
  warRoom: {
    door: { x: 9, y: 2 },
    seats: [
      { tile: { x: 10, y: 1 }, facing: 'left' },
      { tile: { x: 10, y: 2 }, facing: 'left' },
    ],
  },
  hotDesks: [{ tile: { x: 8, y: 7 }, facing: 'up' }],
  coffee: { tile: { x: 2, y: 7 }, facing: 'left' },
  cooler: { tile: { x: 4, y: 7 }, facing: 'up' },
  entrance: { x: 1, y: 9 },
  wanderTiles: [
    { x: 5, y: 6 },
    { x: 6, y: 6 },
    { x: 5, y: 8 },
  ],
};

/** Fully deterministic rng: never picks break tiles, always the last option. */
const stubRng: Rng = {
  next: () => 0.5,
  int: (n) => n - 1,
  pick: (arr) => arr[arr.length - 1],
};

function makeDirector(rng: Rng = stubRng): OfficeDirector {
  return new OfficeDirector({ walkable: makeWalkable(), zones: ZONES, rng });
}

/** Advance the simulation `ms` in 100ms ticks (like the real game loop). */
function step(d: OfficeDirector, ms: number): void {
  for (let t = 0; t < ms; t += 100) d.update(100);
}

function actor(d: OfficeDirector, id: string): ActorSnapshot {
  const a = d.actors().find((s) => s.id === id);
  expect(a, `actor ${id} should exist`).toBeDefined();
  return a as ActorSnapshot;
}

function atTile(s: ActorSnapshot, tile: Vec2): boolean {
  const p = tileCenterPx(tile);
  return s.x === p.x && s.y === p.y;
}

function roster(d: OfficeDirector, ids: string[]): void {
  d.input({
    kind: 'roster',
    sessions: ids.map((id) => ({ id, name: id.toUpperCase() })),
    activeId: ids[0] ?? null,
  });
}

const monitorEffects = (fx: SceneEffect[]) =>
  fx.filter((e): e is Extract<SceneEffect, { kind: 'monitor' }> => e.kind === 'monitor');
const poofEffects = (fx: SceneEffect[]) =>
  fx.filter((e): e is Extract<SceneEffect, { kind: 'poof' }> => e.kind === 'poof');

// ---------- tests -------------------------------------------------------------

describe('OfficeDirector', () => {
  it('spawns roster agents at the entrance and walks them in', () => {
    const d = makeDirector();
    roster(d, ['a']);
    const spawn = actor(d, 'a');
    expect(spawn.role).toBe('agent');
    expect(atTile(spawn, ZONES.entrance)).toBe(true);
    expect(spawn.moving).toBe(true);
    step(d, 2000);
    const later = actor(d, 'a');
    expect(atTile(later, ZONES.entrance)).toBe(false);
  });

  it('assigns seats office 0 → office 1 → hot desk → cooler fallback', () => {
    const d = makeDirector();
    roster(d, ['a', 'b', 'c', 'd']);
    for (const id of ['a', 'b', 'c', 'd']) d.input({ kind: 'turn-started', workspaceId: id });
    step(d, 8000);
    expect(atTile(actor(d, 'a'), ZONES.offices[0].seat.tile)).toBe(true);
    expect(atTile(actor(d, 'b'), ZONES.offices[1].seat.tile)).toBe(true);
    expect(atTile(actor(d, 'c'), ZONES.hotDesks[0].tile)).toBe(true);
    expect(atTile(actor(d, 'd'), ZONES.cooler.tile)).toBe(true);
    for (const id of ['a', 'b', 'c', 'd']) {
      const s = actor(d, id);
      expect(s.seated).toBe(true);
      expect(s.typing).toBe(true);
    }
    expect(actor(d, 'a').facing).toBe(ZONES.offices[0].seat.facing);
    // Monitor effects only for the two office desks.
    const monitors = monitorEffects(d.drainEffects());
    expect(monitors).toContainEqual({ kind: 'monitor', officeIndex: 0, on: true });
    expect(monitors).toContainEqual({ kind: 'monitor', officeIndex: 1, on: true });
    expect(monitors).toHaveLength(2);
  });

  it('turn-complete switches the monitor off and walks the agent back', () => {
    const d = makeDirector();
    roster(d, ['a']);
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    step(d, 8000);
    d.drainEffects();
    d.input({ kind: 'turn-complete', workspaceId: 'a' });
    expect(monitorEffects(d.drainEffects())).toContainEqual({
      kind: 'monitor',
      officeIndex: 0,
      on: false,
    });
    step(d, 100);
    const s = actor(d, 'a');
    expect(s.seated).toBe(false);
    expect(s.typing).toBe(false);
    expect(s.moving).toBe(true); // walking back to the open space
  });

  it('ask-opened freezes mid-walk with an alert icon; ask-cleared resumes to the seat', () => {
    const d = makeDirector();
    roster(d, ['a']);
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    step(d, 500);
    expect(actor(d, 'a').moving).toBe(true);
    d.input({ kind: 'ask-opened', workspaceId: 'a' });
    const frozen = actor(d, 'a');
    expect(frozen.icon).toBe('alert');
    expect(frozen.moving).toBe(false);
    step(d, 1000);
    const still = actor(d, 'a');
    expect(still.x).toBe(frozen.x);
    expect(still.y).toBe(frozen.y);
    expect(still.icon).toBe('alert');
    d.input({ kind: 'ask-cleared', workspaceId: 'a' });
    expect(actor(d, 'a').icon).toBeNull();
    step(d, 8000);
    const seated = actor(d, 'a');
    expect(seated.seated).toBe(true);
    expect(seated.typing).toBe(true);
    expect(atTile(seated, ZONES.offices[0].seat.tile)).toBe(true);
  });

  it('routes deltas, tool calls, denials, and finals into bubbles', () => {
    const d = makeDirector();
    roster(d, ['a']);
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    step(d, 8000);

    d.input({ kind: 'assistant-delta', workspaceId: 'a', delta: 'Hello there' });
    expect(actor(d, 'a').bubble).toEqual({ text: 'Hello there', tone: 'speech' });
    step(d, 4000); // stream expires 3s after last push

    expect(actor(d, 'a').bubble).toBeNull();
    d.input({ kind: 'tool-call', workspaceId: 'a', tool: 'grep' });
    expect(actor(d, 'a').bubble).toEqual({ text: '[grep]', tone: 'tool' });
    step(d, 3000);

    d.input({ kind: 'tool-denied', workspaceId: 'a' });
    expect(actor(d, 'a').bubble).toEqual({ text: '✗ denied', tone: 'error' });
    step(d, 3000);

    d.input({ kind: 'tool-failed', workspaceId: 'a' });
    expect(actor(d, 'a').bubble).toEqual({ text: '! failed', tone: 'error' });
    step(d, 3000);

    d.input({
      kind: 'assistant-final',
      workspaceId: 'a',
      text: 'Done with the task. Here are some more details you asked about.',
    });
    expect(actor(d, 'a').bubble).toEqual({ text: 'Done with the task.', tone: 'speech' });
    step(d, 4100); // final ttl is 4s
    expect(actor(d, 'a').bubble).toBeNull();
  });

  it('runs the full subagent lifecycle: spawn at parent, sit in war room, poof, free seat', () => {
    const d = makeDirector();
    roster(d, ['a']);
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    step(d, 8000);

    d.input({ kind: 'subagent-started', workspaceId: 'a', childId: 'c1', label: 'researcher' });
    expect(d.actors()).toHaveLength(2);
    const spawn = actor(d, 'c1');
    expect(spawn.role).toBe('subagent');
    expect(spawn.name).toBe('researcher');
    expect(atTile(spawn, ZONES.offices[0].seat.tile)).toBe(true); // parent's tile

    step(d, 4000);
    const seated = actor(d, 'c1');
    expect(atTile(seated, ZONES.warRoom.seats[0].tile)).toBe(true);
    expect(seated.seated).toBe(true);
    expect(seated.facing).toBe('left');
    expect(seated.typing).toBe(true);

    d.input({ kind: 'subagent-delta', childId: 'c1', delta: 'Working on it' });
    expect(actor(d, 'c1').bubble).toEqual({ text: 'Working on it', tone: 'speech' });
    d.input({ kind: 'subagent-tool', childId: 'c1', tool: 'grep' });
    expect(actor(d, 'c1').bubble).toEqual({ text: '[grep]', tone: 'tool' });

    d.drainEffects();
    d.input({ kind: 'subagent-done', childId: 'c1', text: 'All done.' });
    expect(actor(d, 'c1').bubble).toEqual({ text: 'All done.', tone: 'speech' });
    step(d, 5000); // 3s bubble + walk to the war-room door
    expect(d.actors()).toHaveLength(1);
    expect(poofEffects(d.drainEffects())).toContainEqual({
      kind: 'poof',
      at: ZONES.warRoom.door,
    });

    // The war-room seat was freed: the next subagent takes seat 0 again.
    d.input({ kind: 'subagent-started', workspaceId: 'a', childId: 'c2', label: 'reviewer' });
    step(d, 4000);
    expect(atTile(actor(d, 'c2'), ZONES.warRoom.seats[0].tile)).toBe(true);
  });

  it('marks failed subagent finals as error bubbles', () => {
    const d = makeDirector();
    roster(d, ['a']);
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    step(d, 8000);
    d.input({ kind: 'subagent-started', workspaceId: 'a', childId: 'c1', label: 'x' });
    step(d, 4000);
    d.input({ kind: 'subagent-done', childId: 'c1', text: 'It broke.', failed: true });
    expect(actor(d, 'c1').bubble).toEqual({ text: 'It broke.', tone: 'error' });
  });

  it("sweeps lingering subagents when the parent's turn completes", () => {
    const d = makeDirector();
    roster(d, ['a']);
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    step(d, 8000);
    d.input({ kind: 'subagent-started', workspaceId: 'a', childId: 'c3', label: 'helper' });
    step(d, 4000);
    expect(actor(d, 'c3').seated).toBe(true);

    d.drainEffects();
    d.input({ kind: 'turn-complete', workspaceId: 'a' });
    step(d, 4000);
    expect(d.actors().map((s) => s.id)).toEqual(['a']);
    expect(poofEffects(d.drainEffects())).toHaveLength(1);
  });

  it('session-removed walks the agent out and frees its seat for the next spawn', () => {
    const d = makeDirector();
    roster(d, ['a', 'b']);
    step(d, 100);
    d.input({ kind: 'session-removed', workspaceId: 'a' });
    step(d, 8000);
    expect(d.actors().map((s) => s.id)).toEqual(['b']);

    roster(d, ['b', 'e']);
    d.input({ kind: 'turn-started', workspaceId: 'e' });
    step(d, 8000);
    const e = actor(d, 'e');
    expect(e.seated).toBe(true);
    expect(atTile(e, ZONES.offices[0].seat.tile)).toBe(true); // office 0 was freed
    const monitors = monitorEffects(d.drainEffects());
    expect(monitors).toContainEqual({ kind: 'monitor', officeIndex: 0, on: true });
  });

  it('removes agents dropped from the roster', () => {
    const d = makeDirector();
    roster(d, ['a', 'b']);
    step(d, 100);
    roster(d, ['b']);
    step(d, 8000);
    expect(d.actors().map((s) => s.id)).toEqual(['b']);
  });

  it('updates names on roster changes', () => {
    const d = makeDirector();
    roster(d, ['a']);
    expect(actor(d, 'a').name).toBe('A');
    d.input({ kind: 'roster', sessions: [{ id: 'a', name: 'Renamed' }], activeId: 'a' });
    expect(actor(d, 'a').name).toBe('Renamed');
  });

  it('shows zzz after 30s of no activity, cleared on input', () => {
    const d = makeDirector();
    roster(d, ['a']);
    step(d, 40_000);
    expect(actor(d, 'a').icon).toBe('zzz');
    d.input({ kind: 'turn-started', workspaceId: 'a' });
    expect(actor(d, 'a').icon).toBeNull();
  });

  it('shows the coffee icon while dwelling at the coffee tile', () => {
    // This rng always picks break tiles (int → 0) and the first option
    // (pick → arr[0] = the coffee tile).
    const coffeeRng: Rng = { next: () => 0.5, int: () => 0, pick: (arr) => arr[0] };
    const d = makeDirector(coffeeRng);
    roster(d, ['a']);
    let sawCoffee = false;
    for (let t = 0; t < 20_000 && !sawCoffee; t += 100) {
      d.update(100);
      const s = actor(d, 'a');
      if (s.icon === 'coffee') {
        sawCoffee = true;
        expect(atTile(s, ZONES.coffee.tile)).toBe(true);
      }
    }
    expect(sawCoffee).toBe(true);
  });
});
