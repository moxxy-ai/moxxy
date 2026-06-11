import { describe, expect, it } from 'vitest';
import { findPath } from './astar.js';
import type { Vec2, Walkability } from './types.js';

/** Builds a w×h all-walkable grid, then knocks out the listed tiles. */
function grid(w: number, h: number, walls: ReadonlyArray<Vec2> = []): Walkability {
  const g = Array.from({ length: h }, () => Array.from({ length: w }, () => true));
  for (const t of walls) g[t.y][t.x] = false;
  return g;
}

function isContiguous(path: ReadonlyArray<Vec2>): boolean {
  for (let i = 1; i < path.length; i++) {
    const d = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
    if (d !== 1) return false;
  }
  return true;
}

describe('findPath', () => {
  it('finds a straight line, endpoints included', () => {
    const path = findPath(grid(5, 5), { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('routes around a wall with an optimal contiguous path', () => {
    // Wall column at x=2 from y=0..3; only gap is y=4.
    const walls = [0, 1, 2, 3].map((y) => ({ x: 2, y }));
    const path = findPath(grid(5, 5, walls), { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
    expect(isContiguous(path!)).toBe(true);
    expect(path!.length).toBe(13); // down 4, across 4, up 4
    for (const t of path!) expect(walls).not.toContainEqual(t);
  });

  it('returns null when unreachable', () => {
    const walls = [0, 1, 2, 3, 4].map((y) => ({ x: 2, y }));
    expect(findPath(grid(5, 5, walls), { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });

  it('returns [from] when from === to and walkable', () => {
    expect(findPath(grid(3, 3), { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
  });

  it('returns null when either endpoint is unwalkable (even from === to)', () => {
    const g = grid(3, 3, [{ x: 1, y: 1 }]);
    expect(findPath(g, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(findPath(g, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('returns null for out-of-bounds endpoints', () => {
    expect(findPath(grid(3, 3), { x: -1, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(grid(3, 3), { x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
  });

  it('breaks ties deterministically (up, down, left, right expansion)', () => {
    // On a 2x2 grid both L-paths cost the same; the down-first neighbor order
    // must win every time.
    const path = findPath(grid(2, 2), { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});
