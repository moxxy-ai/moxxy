/**
 * `?gallery=1` — the art-review surface. Renders the ENTIRE inventory (tiles,
 * props, character looks with live walk/type cycles, hair styles, icons,
 * bubbles, the full map) onto plain canvases at 4×, no Phaser involved. This
 * is where "does it look amazing?" gets answered before polish ends.
 */

import { drawGrid, type ColorMap, type PixelGrid } from './art/pixel.js';
import { LOOKS } from './art/palette.js';
import { TILE_ART } from './art/tiles.js';
import { PROP_ART } from './art/props.js';
import { BODY_FRAMES, HAIR_STYLES, charColors, CHAR_H, CHAR_W } from './art/characters.js';
import { ICON_ART, POOF_FRAMES } from './art/icons.js';
import { BUBBLE_GRID, BUBBLE_TAIL, bubbleColors } from './art/bubble.js';
import { OFFICE_MAP, renderGrid } from './map/office-map.js';
import { MAP_H, MAP_W, TILE } from './sim/types.js';

const SCALE = 4;

function canvasFor(grid: PixelGrid, colors: ColorMap, scale = SCALE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = (grid[0]?.length ?? 0) * scale;
  canvas.height = grid.length * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  drawGrid(ctx, grid, colors, 0, 0, scale);
  return canvas;
}

function section(root: HTMLElement, title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'color:#e6e9ef;font:600 16px sans-serif;margin:24px 0 8px;width:100%;';
  root.appendChild(h);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;';
  root.appendChild(row);
  return row;
}

function labeled(row: HTMLElement, label: string, el: HTMLElement): void {
  const wrap = document.createElement('figure');
  wrap.style.cssText = 'margin:0;text-align:center;';
  el.style.imageRendering = 'pixelated';
  wrap.appendChild(el);
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  cap.style.cssText = 'color:#8b93a7;font:10px monospace;margin-top:2px;max-width:96px;';
  wrap.appendChild(cap);
  row.appendChild(wrap);
}

/** A live-animated character preview cycling the given frames. */
function animatedChar(lookIdx: number, frames: ReadonlyArray<keyof typeof BODY_FRAMES>, fps = 8): HTMLCanvasElement {
  const look = LOOKS[lookIdx]!;
  const colors = charColors(look);
  const canvas = document.createElement('canvas');
  canvas.width = CHAR_W * SCALE;
  canvas.height = CHAR_H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  let i = 0;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const frame = frames[i % frames.length]!;
    drawGrid(ctx, BODY_FRAMES[frame], colors, 0, 0, SCALE);
    const facing = String(frame).includes('Up') ? 'up' : String(frame).includes('Right') ? 'right' : 'down';
    const hair = HAIR_STYLES[facing as 'down' | 'up' | 'right'][look.hairStyle % 4];
    if (hair) drawGrid(ctx, hair, colors, 0, 0, SCALE);
    i += 1;
  };
  draw();
  window.setInterval(draw, 1000 / fps);
  return canvas;
}

export function renderGallery(root: HTMLElement): void {
  root.style.cssText = 'padding:20px;overflow:auto;position:absolute;inset:0;display:block;';

  const heading = document.createElement('h1');
  heading.textContent = 'moxxy virtual office — sprite gallery';
  heading.style.cssText = 'color:#f4efe2;font:700 20px sans-serif;margin:0;';
  root.appendChild(heading);

  let row = section(root, 'The office');
  {
    const grid = renderGrid();
    const canvas = document.createElement('canvas');
    canvas.width = MAP_W * TILE * 2;
    canvas.height = MAP_H * TILE * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const cell = grid[y]?.[x];
        if (!cell) continue;
        const tile = TILE_ART[cell.floor as keyof typeof TILE_ART];
        if (tile) drawGrid(ctx, tile.grid, tile.colors, x * TILE * 2, y * TILE * 2, 2);
      }
    }
    // Props on top (taller props draw up into the previous row).
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const prop = grid[y]?.[x]?.prop;
        if (!prop) continue;
        const art = PROP_ART[prop as keyof typeof PROP_ART];
        if (art) drawGrid(ctx, art.grid, art.colors, x * TILE * 2, (y * TILE + TILE - art.h) * 2, 2);
      }
    }
    canvas.style.imageRendering = 'pixelated';
    canvas.style.border = '1px solid #2a2f3a';
    row.appendChild(canvas);
  }

  row = section(root, `Characters — ${LOOKS.length} looks (walk / type / sit)`);
  LOOKS.forEach((_, i) => {
    labeled(row, `look ${i} walk`, animatedChar(i, ['walkDown1', 'walkDown2', 'walkDown3', 'walkDown4']));
  });
  row = section(root, 'Poses');
  labeled(row, 'idle breath', animatedChar(0, ['idleDown', 'idleDown', 'idleDown2', 'blinkDown'], 2));
  labeled(row, 'walk right', animatedChar(1, ['walkRight1', 'walkRight2', 'walkRight3', 'walkRight4']));
  labeled(row, 'walk up', animatedChar(2, ['walkUp1', 'walkUp2', 'walkUp3', 'walkUp4']));
  labeled(row, 'typing', animatedChar(3, ['typeUp1', 'typeUp2'], 5));
  labeled(row, 'sit down', animatedChar(4, ['sitDown'], 1));
  labeled(row, 'sit right', animatedChar(5, ['sitRight'], 1));
  labeled(row, 'sit up', animatedChar(6, ['sitUp'], 1));

  row = section(root, 'Tiles');
  for (const [name, art] of Object.entries(TILE_ART)) {
    labeled(row, name, canvasFor(art.grid, art.colors));
  }

  row = section(root, 'Props & furniture');
  for (const [name, art] of Object.entries(PROP_ART)) {
    labeled(row, name, canvasFor(art.grid, art.colors));
  }

  row = section(root, 'Icons & poof');
  for (const [name, art] of Object.entries(ICON_ART)) {
    labeled(row, name, canvasFor(art.grid, art.colors, 6));
  }
  POOF_FRAMES.forEach((frame, i) => labeled(row, `poof ${i + 1}`, canvasFor(frame.grid, frame.colors, 6)));

  row = section(root, 'Bubbles');
  for (const tone of ['speech', 'thought', 'tool', 'alert', 'error'] as const) {
    labeled(row, tone, canvasFor(BUBBLE_GRID, bubbleColors(tone)));
    labeled(row, `${tone} tail`, canvasFor(BUBBLE_TAIL, bubbleColors(tone)));
  }

  // Raw ASCII map for level-design review.
  const pre = document.createElement('pre');
  pre.textContent = OFFICE_MAP.join('\n');
  pre.style.cssText = 'color:#8b93a7;font:10px/1.1 monospace;margin-top:24px;';
  root.appendChild(pre);
}
