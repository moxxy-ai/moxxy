/**
 * Pure pixel-grid rasterizer. Sprites are authored as string grids — one
 * character per pixel, `.` (or space) = transparent — with a per-sprite map
 * from character to a master-PALETTE key. Rendering targets any 2D context
 * (offscreen canvas in the game, a fake in tests), so the art data and its
 * validation stay DOM-free.
 */

import { PALETTE, type PaletteKey } from './palette.js';

export type PixelGrid = ReadonlyArray<string>;
export type ColorMap = Readonly<Record<string, PaletteKey>>;

/** The slice of CanvasRenderingContext2D the rasterizer touches. */
export interface Ctx2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export function isTransparent(ch: string): boolean {
  return ch === '.' || ch === ' ';
}

/** Draw a grid at (ox, oy), one filled rect per run of same-colored pixels. */
export function drawGrid(
  ctx: Ctx2DLike,
  grid: PixelGrid,
  colors: ColorMap,
  ox = 0,
  oy = 0,
  scale = 1,
): void {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!;
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      if (isTransparent(ch)) {
        x++;
        continue;
      }
      // Run-length the row so wide fills are one fillRect, not N.
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const key = colors[ch];
      if (key) {
        ctx.fillStyle = PALETTE[key];
        ctx.fillRect(ox + x * scale, oy + y * scale, (end - x) * scale, scale);
      }
      x = end;
    }
  }
}

export interface GridProblem {
  readonly grid: string;
  readonly problem: string;
}

/**
 * Validate authored art: every row the declared width, every non-transparent
 * character mapped. Run in tests over the full inventory so a stray pixel or
 * missing mapping fails CI instead of rendering as a hole.
 */
export function validateGrid(
  name: string,
  grid: PixelGrid,
  colors: ColorMap,
  expected?: { w: number; h: number },
): GridProblem[] {
  const problems: GridProblem[] = [];
  if (grid.length === 0) problems.push({ grid: name, problem: 'empty grid' });
  const width = expected?.w ?? grid[0]?.length ?? 0;
  if (expected && grid.length !== expected.h) {
    problems.push({ grid: name, problem: `height ${grid.length} ≠ ${expected.h}` });
  }
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!;
    if (row.length !== width) {
      problems.push({ grid: name, problem: `row ${y} width ${row.length} ≠ ${width}` });
    }
    for (const ch of row) {
      if (!isTransparent(ch) && !colors[ch]) {
        problems.push({ grid: name, problem: `row ${y}: unmapped char '${ch}'` });
        break;
      }
    }
  }
  return problems;
}
