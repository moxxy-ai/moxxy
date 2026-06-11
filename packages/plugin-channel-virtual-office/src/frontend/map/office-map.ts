/**
 * The office map — single source of truth for layout, collision and zones.
 *
 * One ASCII row per tile row (44 chars × 30 rows, tile (0,0) top-left).
 * Layout, north to south:
 *
 *   rows 0-7   six private offices along the north wall (desk + monitor +
 *              chair each), doorways onto the corridor in row 7
 *   rows 8-9   east-west corridor
 *   rows 10-20 war room (west, carpet, 4×2 conference table, glass wall on
 *              its east side) and the open space (center/east: 4 hot desks,
 *              rug, coffee machine + water cooler + printer on the east wall)
 *   rows 21-23 open walkway joining the open space to the lounge
 *   rows 24-28 lounge strip (carpet + rug), entrance mat at the doors
 *   row 29     south wall with the double entrance door at x=21..22
 *
 * Legend (fixed — the art package keys off these names):
 *   '#' wallTop   'W' wallFace   'n' window   'g' glassFace
 *   '.' floorWood ',' floorWoodAlt ':' carpet ';' carpetAlt 'r' rug
 *   'D' doorway   'E' entranceMat
 *   '[' deskLeft  ']' deskMonitor '=' deskRight
 *   'h' chair (walkable pass-through; variant resolved by neighbors)
 *   'T' conference table (variant resolved by position in the 4×2 block)
 *   'p' plantBig  'q' plantSmall  'b' bookshelf
 *   'c' coffeeMachine1 'w' waterCooler1 'P' printer
 *   'B' whiteboard (sits in the war room's north wall row, on wallFace)
 */

import { MAP_H, MAP_W, type Facing } from '../sim/types.js';

// prettier-ignore
export const OFFICE_MAP: ReadonlyArray<string> = [
  '############################################', //  0
  '#WnnWWW#WWnnWW#WnnWWW#WWnnWW#WnnWWW#WWnnWWW#', //  1
  '#.[]..p#b.[]..#.[]..q#p.[].b#.[].,p#b.[].,.#', //  2
  '#.,h...#..,h..#.,h...#..,h..#..h,..#.,.h...#', //  3
  '#..,...#.....,#...,..#......#.,....#....,..#', //  4
  '#......#,.....#.....,#..,...#......#.....,.#', //  5
  '#...,..#......#,.....#....,.#...,..#......q#', //  6
  '#WWWDWWWWWDWWWWWWDWWWWWWDWWWWWWDWWWWWWWDWWW#', //  7
  '#q....,.......,........,.......,......,....#', //  8
  '#...,........,......,.........,........,...#', //  9
  '#WWWBBBWWWWW#..bb..,......,.P...,.....,...p#', // 10
  '#::;::::::p:g.....,........,.......,.......#', // 11
  '#:;:::::::;:g....[].....[]..,.........,...c#', // 12
  '#:::hhh:::::g.....h......h.....rrrrr.,.....#', // 13
  '#::hTTTT::::g....,.........,...rrrrr......w#', // 14
  '#:::TTTTh:;:D......,.......,...rrrrr...,...#', // 15
  '#::::hhh::::g....[]....,[],....rrrrr......P#', // 16
  '#:::;:::;:::g.....h.,....h....,........q...#', // 17
  '#:;:::::::::g...,.........,..........,.....#', // 18
  '#p:::;::::::gq.....,..........,........,...#', // 19
  '#WWWWWWWWWWW#.....,........,.......,.......#', // 20
  '#...,.........,........,..........,........#', // 21
  '#.,..........,.........,......,...........,#', // 22
  '#......,........,...........,.........,....#', // 23
  '#::;::::::::;::::::::::;:::::::::;:::::::::#', // 24
  '#::::q:::::::;:::rrrrrrrrrr;::::::::::q::::#', // 25
  '#:;::::::::::;:::rrrrrrrrrr::::;:::::::::;:#', // 26
  '#::::::;:::::::::rrrrrrrrrr:;::::::::::::::#', // 27
  '#p:::;::::::::;::::::EE::::;::::::::;:::::p#', // 28
  '#####################DD#####################', // 29
];

// ---------- legend ----------------------------------------------------------

/** Walkable floor chars → floor tile name. */
const FLOOR_TILES: Readonly<Record<string, string>> = {
  '.': 'floorWood',
  ',': 'floorWoodAlt',
  ':': 'carpet',
  ';': 'carpetAlt',
  r: 'rug',
  D: 'doorway',
  E: 'entranceMat',
};

/** Wall-like chars → "floor" tile name (drawn as the cell's base). */
const WALL_TILES: Readonly<Record<string, string>> = {
  '#': 'wallTop',
  W: 'wallFace',
  n: 'window',
  g: 'glassFace',
};

/** Props that map 1:1 to a sprite, no neighbor context needed. */
const SIMPLE_PROPS: Readonly<Record<string, string>> = {
  '[': 'deskLeft',
  ']': 'deskMonitor',
  '=': 'deskRight',
  p: 'plantBig',
  q: 'plantSmall',
  c: 'coffeeMachine1',
  w: 'waterCooler1',
  b: 'bookshelf',
  P: 'printer',
};

/** Chars an office worker can occupy (chairs are pass-through sit targets). */
export const LEGEND_WALKABLE: ReadonlySet<string> = new Set([
  '.',
  ',',
  ':',
  ';',
  'r',
  'D',
  'E',
  'h',
]);

/** Every char the map is allowed to contain (the test enforces this). */
export const LEGEND_CHARS: ReadonlySet<string> = new Set([
  ...Object.keys(FLOOR_TILES),
  ...Object.keys(WALL_TILES),
  ...Object.keys(SIMPLE_PROPS),
  'h',
  'T',
  'B',
]);

// ---------- render grid ------------------------------------------------------

export interface RenderCell {
  readonly floor: string;
  readonly prop?: string;
  readonly propFacing?: Facing;
}

/** Desk/table surfaces a chair can be tucked against. */
const SITTABLE = new Set(['[', ']', '=', 'T']);

function charAt(x: number, y: number): string {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return '#';
  return OFFICE_MAP[y]!.charAt(x);
}

/**
 * Floor tile under a prop: BFS outward to the nearest plain floor char and
 * borrow its tile, so war-room furniture sits on carpet, lounge plants on
 * carpet, and everything else on wood — without a hand-kept region table.
 */
function inferFloor(x: number, y: number): string {
  const seen = new Set<number>([y * MAP_W + x]);
  const queue: Array<readonly [number, number]> = [[x, y]];
  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    const ch = charAt(cx, cy);
    const tile = FLOOR_TILES[ch];
    if (tile !== undefined && tile !== 'doorway' && tile !== 'entranceMat') return tile;
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = ny * MAP_W + nx;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || seen.has(key)) continue;
      if (WALL_TILES[charAt(nx, ny)] !== undefined) continue; // don't leak through walls
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return 'floorWood';
}

function resolveChair(x: number, y: number): { prop: string; facing: Facing } {
  if (SITTABLE.has(charAt(x, y - 1))) return { prop: 'chairUp', facing: 'up' };
  if (SITTABLE.has(charAt(x, y + 1))) return { prop: 'chairDown', facing: 'down' };
  if (SITTABLE.has(charAt(x + 1, y))) return { prop: 'chairRight', facing: 'right' };
  if (SITTABLE.has(charAt(x - 1, y))) return { prop: 'chairLeft', facing: 'left' };
  return { prop: 'chairDown', facing: 'down' };
}

function resolveConf(x: number, y: number): string {
  const top = charAt(x, y + 1) === 'T'; // another table tile below → this is the top row
  const left = charAt(x - 1, y) !== 'T';
  const right = charAt(x + 1, y) !== 'T';
  if (top) return left ? 'confTL' : right ? 'confTR' : 'confT';
  return left ? 'confBL' : right ? 'confBR' : 'confB';
}

/** Resolve the ASCII map into per-tile floor + prop sprite names. */
export function renderGrid(): RenderCell[][] {
  const grid: RenderCell[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: RenderCell[] = [];
    for (let x = 0; x < MAP_W; x++) {
      const ch = charAt(x, y);
      const floorTile = FLOOR_TILES[ch];
      if (floorTile !== undefined) {
        row.push({ floor: floorTile });
        continue;
      }
      const wallTile = WALL_TILES[ch];
      if (wallTile !== undefined) {
        row.push({ floor: wallTile });
        continue;
      }
      if (ch === 'B') {
        // Whiteboard hangs on the war room's north wall face.
        row.push({ floor: 'wallFace', prop: 'whiteboard' });
        continue;
      }
      if (ch === 'h') {
        const chair = resolveChair(x, y);
        row.push({ floor: inferFloor(x, y), prop: chair.prop, propFacing: chair.facing });
        continue;
      }
      if (ch === 'T') {
        row.push({ floor: inferFloor(x, y), prop: resolveConf(x, y) });
        continue;
      }
      const simple = SIMPLE_PROPS[ch];
      if (simple !== undefined) {
        row.push({ floor: inferFloor(x, y), prop: simple });
        continue;
      }
      throw new Error(`office-map: unknown legend char '${ch}' at (${x},${y})`);
    }
    grid.push(row);
  }
  return grid;
}
