import { describe, expect, it } from 'vitest';

import { MAP_H, MAP_W, type Vec2 } from '../sim/types.js';
import { walkableFrom } from './collision.js';
import { LEGEND_CHARS, LEGEND_WALKABLE, OFFICE_MAP, renderGrid } from './office-map.js';
import { ZONES } from './zones.js';

const at = (t: Vec2): string => OFFICE_MAP[t.y]!.charAt(t.x);

const NEIGHBORS = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
] as const;

function adjacentTo(t: Vec2, ch: string): boolean {
  return NEIGHBORS.some((d) => OFFICE_MAP[t.y + d.y]?.charAt(t.x + d.x) === ch);
}

/** All tiles reachable on foot from `start`. */
function reachableFrom(start: Vec2): Set<number> {
  const walkable = walkableFrom(OFFICE_MAP);
  const seen = new Set<number>([start.y * MAP_W + start.x]);
  const queue: Vec2[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of NEIGHBORS) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      const key = next.y * MAP_W + next.x;
      if (next.x < 0 || next.y < 0 || next.x >= MAP_W || next.y >= MAP_H) continue;
      if (seen.has(key) || !walkable[next.y]![next.x]) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

describe('OFFICE_MAP shape', () => {
  it(`is exactly ${MAP_H} rows of ${MAP_W} chars`, () => {
    expect(OFFICE_MAP).toHaveLength(MAP_H);
    for (const [y, row] of OFFICE_MAP.entries()) {
      expect(row.length, `row ${y}`).toBe(MAP_W);
    }
  });

  it('contains only legend chars', () => {
    for (const [y, row] of OFFICE_MAP.entries()) {
      for (const [x, ch] of [...row].entries()) {
        expect(LEGEND_CHARS.has(ch), `char '${ch}' at (${x},${y})`).toBe(true);
      }
    }
  });

  it('outer boundary is sealed except the entrance doors', () => {
    const walkable = walkableFrom(OFFICE_MAP);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (x !== 0 && y !== 0 && x !== MAP_W - 1 && y !== MAP_H - 1) continue;
        const isEntrance = y === MAP_H - 1 && (x === 21 || x === 22);
        expect(walkable[y]![x], `boundary (${x},${y})`).toBe(isEntrance);
      }
    }
    expect(at({ x: 21, y: 29 })).toBe('D');
    expect(at({ x: 22, y: 29 })).toBe('D');
  });
});

describe('ZONES contracts', () => {
  const walkable = walkableFrom(OFFICE_MAP);
  const isWalkable = (t: Vec2): boolean => walkable[t.y]?.[t.x] === true;

  it('has six offices with walkable door/seat and a monitor desk half', () => {
    expect(ZONES.offices).toHaveLength(6);
    for (const office of ZONES.offices) {
      expect(at(office.door), `office ${office.index} door`).toBe('D');
      expect(isWalkable(office.seat.tile), `office ${office.index} seat`).toBe(true);
      expect(at(office.seat.tile), `office ${office.index} seat char`).toBe('h');
      expect(office.seat.facing).toBe('up');
      expect(at(office.monitorTile), `office ${office.index} monitor`).toBe(']');
      // The seat is tucked right under its monitor.
      expect(office.seat.tile).toEqual({ x: office.monitorTile.x, y: office.monitorTile.y + 1 });
    }
  });

  it('war room: walkable door, eight chair seats hugging the conference table', () => {
    expect(isWalkable(ZONES.warRoom.door)).toBe(true);
    expect(at(ZONES.warRoom.door)).toBe('D');
    expect(ZONES.warRoom.seats).toHaveLength(8);
    for (const seat of ZONES.warRoom.seats) {
      expect(isWalkable(seat.tile), `war seat (${seat.tile.x},${seat.tile.y})`).toBe(true);
      expect(at(seat.tile)).toBe('h');
      expect(adjacentTo(seat.tile, 'T'), `war seat (${seat.tile.x},${seat.tile.y}) by table`).toBe(
        true,
      );
    }
    const facings = ZONES.warRoom.seats.map((s) => s.facing);
    expect(facings.filter((f) => f === 'down')).toHaveLength(3);
    expect(facings.filter((f) => f === 'up')).toHaveLength(3);
    expect(facings.filter((f) => f === 'right')).toHaveLength(1);
    expect(facings.filter((f) => f === 'left')).toHaveLength(1);
  });

  it('hot desks: four walkable chairs under desks', () => {
    expect(ZONES.hotDesks).toHaveLength(4);
    for (const seat of ZONES.hotDesks) {
      expect(isWalkable(seat.tile), `hot desk (${seat.tile.x},${seat.tile.y})`).toBe(true);
      expect(at(seat.tile)).toBe('h');
      expect(seat.facing).toBe('up');
      expect(at({ x: seat.tile.x, y: seat.tile.y - 1 })).toBe(']');
    }
  });

  it('coffee and cooler stand-tiles face their appliance', () => {
    expect(isWalkable(ZONES.coffee.tile)).toBe(true);
    expect(adjacentTo(ZONES.coffee.tile, 'c')).toBe(true);
    expect(isWalkable(ZONES.cooler.tile)).toBe(true);
    expect(adjacentTo(ZONES.cooler.tile, 'w')).toBe(true);
  });

  it('entrance tile is walkable, on the mat, inside the doors', () => {
    expect(isWalkable(ZONES.entrance)).toBe(true);
    expect(at(ZONES.entrance)).toBe('E');
  });

  it('wander tiles: 12-20 distinct walkable tiles', () => {
    expect(ZONES.wanderTiles.length).toBeGreaterThanOrEqual(12);
    expect(ZONES.wanderTiles.length).toBeLessThanOrEqual(20);
    const keys = new Set(ZONES.wanderTiles.map((t) => t.y * MAP_W + t.x));
    expect(keys.size).toBe(ZONES.wanderTiles.length);
    for (const t of ZONES.wanderTiles) {
      expect(isWalkable(t), `wander (${t.x},${t.y})`).toBe(true);
    }
  });
});

describe('connectivity', () => {
  it('every point of interest is reachable on foot from the entrance', () => {
    const reachable = reachableFrom(ZONES.entrance);
    const targets: Array<readonly [string, Vec2]> = [
      ...ZONES.offices.flatMap(
        (o) =>
          [
            [`office ${o.index} door`, o.door],
            [`office ${o.index} seat`, o.seat.tile],
          ] as const,
      ),
      ['war room door', ZONES.warRoom.door],
      ...ZONES.warRoom.seats.map((s, i) => [`war seat ${i}`, s.tile] as const),
      ...ZONES.hotDesks.map((s, i) => [`hot desk ${i}`, s.tile] as const),
      ['coffee', ZONES.coffee.tile],
      ['cooler', ZONES.cooler.tile],
      ...ZONES.wanderTiles.map((t, i) => [`wander ${i}`, t] as const),
    ];
    for (const [label, t] of targets) {
      expect(reachable.has(t.y * MAP_W + t.x), `${label} (${t.x},${t.y})`).toBe(true);
    }
  });
});

describe('renderGrid', () => {
  const KNOWN_PROPS = new Set([
    'deskLeft',
    'deskRight',
    'deskMonitor',
    'chairDown',
    'chairUp',
    'chairLeft',
    'chairRight',
    'confTL',
    'confT',
    'confTR',
    'confBL',
    'confB',
    'confBR',
    'plantBig',
    'plantSmall',
    'coffeeMachine1',
    'waterCooler1',
    'bookshelf',
    'printer',
    'whiteboard',
  ]);

  it('resolves every prop char to a known prop sprite', () => {
    const grid = renderGrid();
    expect(grid).toHaveLength(MAP_H);
    for (const [y, row] of grid.entries()) {
      expect(row).toHaveLength(MAP_W);
      for (const [x, cell] of row.entries()) {
        if (cell.prop === undefined) continue;
        expect(KNOWN_PROPS.has(cell.prop), `prop '${cell.prop}' at (${x},${y})`).toBe(true);
      }
    }
  });

  it('resolves chair orientation toward the furniture it serves', () => {
    const grid = renderGrid();
    // Office + hot-desk chairs sit south of a desk → face up.
    for (const seat of [...ZONES.offices.map((o) => o.seat), ...ZONES.hotDesks]) {
      expect(grid[seat.tile.y]![seat.tile.x]!.prop).toBe('chairUp');
    }
    // War-room chairs match their hand-authored facing.
    const byFacing = { up: 'chairUp', down: 'chairDown', left: 'chairLeft', right: 'chairRight' };
    for (const seat of ZONES.warRoom.seats) {
      const cell = grid[seat.tile.y]![seat.tile.x]!;
      expect(cell.prop, `war chair (${seat.tile.x},${seat.tile.y})`).toBe(byFacing[seat.facing]);
      expect(cell.propFacing).toBe(seat.facing);
      expect(cell.floor).toBe('carpet'); // war room is carpeted
    }
  });

  it('resolves the 4×2 conference table block corner/edge variants', () => {
    const grid = renderGrid();
    const props = (y: number): ReadonlyArray<string | undefined> =>
      [4, 5, 6, 7].map((x) => grid[y]![x]!.prop);
    expect(props(14)).toEqual(['confTL', 'confT', 'confT', 'confTR']);
    expect(props(15)).toEqual(['confBL', 'confB', 'confB', 'confBR']);
  });

  it('keeps walkable floor variety (alt tiles sprinkled in)', () => {
    const flat = OFFICE_MAP.join('');
    expect([...flat].filter((c) => c === ',').length).toBeGreaterThan(20);
    expect([...flat].filter((c) => c === ';').length).toBeGreaterThan(10);
    expect(LEGEND_WALKABLE.has('h')).toBe(true);
  });
});
