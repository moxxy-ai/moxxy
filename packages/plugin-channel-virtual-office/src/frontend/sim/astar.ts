/**
 * 4-directional A* over the office walkability grid. The grid is tiny
 * (≤ 44×30) so the open list is a plain array scanned for the lowest f —
 * no heap needed. Tie-breaking is deterministic: among equal-f nodes the
 * earliest-inserted wins, and neighbors are expanded up, down, left, right.
 */

import type { Vec2, Walkability } from './types.js';

const DIRS: ReadonlyArray<Vec2> = [
  { x: 0, y: -1 }, // up
  { x: 0, y: 1 }, // down
  { x: -1, y: 0 }, // left
  { x: 1, y: 0 }, // right
];

/**
 * Returns the tile path INCLUDING `from` and `to`, or null when unreachable
 * or either endpoint is unwalkable. `from === to` on a walkable tile yields
 * `[from]`.
 */
export function findPath(walkable: Walkability, from: Vec2, to: Vec2): Vec2[] | null {
  const h = walkable.length;
  const w = h > 0 ? walkable[0].length : 0;
  const ok = (x: number, y: number): boolean => x >= 0 && x < w && y >= 0 && y < h && walkable[y][x];
  if (!ok(from.x, from.y) || !ok(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [{ x: from.x, y: from.y }];

  const key = (x: number, y: number): number => y * w + x;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  interface Node {
    readonly x: number;
    readonly y: number;
    readonly f: number;
  }
  const open: Node[] = [
    { x: from.x, y: from.y, f: Math.abs(from.x - to.x) + Math.abs(from.y - to.y) },
  ];
  gScore.set(key(from.x, from.y), 0);

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f) best = i;
    }
    const cur = open.splice(best, 1)[0];
    const ck = key(cur.x, cur.y);
    if (cur.x === to.x && cur.y === to.y) {
      const path: Vec2[] = [];
      let k = ck;
      for (;;) {
        path.push({ x: k % w, y: Math.floor(k / w) });
        const prev = cameFrom.get(k);
        if (prev === undefined) break;
        k = prev;
      }
      path.reverse();
      return path;
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    const g = gScore.get(ck) ?? 0;
    for (const d of DIRS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!ok(nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = g + 1;
      const old = gScore.get(nk);
      if (old !== undefined && old <= ng) continue;
      gScore.set(nk, ng);
      cameFrom.set(nk, ck);
      open.push({ x: nx, y: ny, f: ng + Math.abs(nx - to.x) + Math.abs(ny - to.y) });
    }
  }
  return null;
}
