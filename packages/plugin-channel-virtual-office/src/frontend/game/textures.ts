/**
 * Turns the authored pixel-grid art into Phaser textures at boot. Everything
 * is generated — no binary assets: the static world (floors + walls) becomes
 * ONE canvas texture painted from the map's renderGrid(); each prop, icon and
 * bubble tone gets its own small canvas; character sheets are generated lazily
 * per look (palette swap + hair overlay) so at most 12 sheets ever exist.
 */

import type Phaser from 'phaser';

import { drawGrid } from '../art/pixel.js';
import { PALETTE, LOOKS } from '../art/palette.js';
import { TILE_ART } from '../art/tiles.js';
import { PROP_ART, type PropName } from '../art/props.js';
import {
  BODY_FRAMES,
  HAIR_STYLES,
  charColors,
  CHAR_W,
  CHAR_H,
  type BodyFrameName,
} from '../art/characters.js';
import { ICON_ART, POOF_FRAMES } from '../art/icons.js';
import { BUBBLE_GRID, BUBBLE_TAIL, bubbleColors } from '../art/bubble.js';
import { OFFICE_MAP, renderGrid } from '../map/office-map.js';
import { TILE, MAP_H, MAP_W, type BubbleTone, type Facing } from '../sim/types.js';

export const FRAME_ORDER: ReadonlyArray<BodyFrameName> = [
  'idleDown',
  'idleDown2',
  'blinkDown',
  'idleUp',
  'idleRight',
  'walkDown1',
  'walkDown2',
  'walkDown3',
  'walkDown4',
  'walkUp1',
  'walkUp2',
  'walkUp3',
  'walkUp4',
  'walkRight1',
  'walkRight2',
  'walkRight3',
  'walkRight4',
  'sitUp',
  'typeUp1',
  'typeUp2',
  'sitDown',
  'sitRight',
];

/** Which hair-overlay facing each body frame uses. */
function hairFacingOf(frame: BodyFrameName): 'down' | 'up' | 'right' {
  if (frame.includes('Up') || frame === 'sitUp') return 'up';
  if (frame.includes('Right')) return 'right';
  return 'down';
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function ctxOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Paint the full static world (floors, walls, windows) into one texture. */
export function buildWorldTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('world')) return;
  const canvas = makeCanvas(MAP_W * TILE, MAP_H * TILE);
  const ctx = ctxOf(canvas);
  const grid = renderGrid();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const cell = grid[y]?.[x];
      if (!cell) continue;
      const art = TILE_ART[cell.floor as keyof typeof TILE_ART];
      if (art) drawGrid(ctx, art.grid, art.colors, x * TILE, y * TILE);
    }
  }
  scene.textures.addCanvas('world', canvas);
}

export function buildPropTextures(scene: Phaser.Scene): void {
  for (const [name, art] of Object.entries(PROP_ART)) {
    const key = `prop-${name}`;
    if (scene.textures.exists(key)) continue;
    const canvas = makeCanvas(art.w, art.h);
    drawGrid(ctxOf(canvas), art.grid, art.colors);
    scene.textures.addCanvas(key, canvas);
  }
}

export function buildIconTextures(scene: Phaser.Scene): void {
  for (const [name, art] of Object.entries(ICON_ART)) {
    const key = `icon-${name}`;
    if (scene.textures.exists(key)) continue;
    const canvas = makeCanvas(8, 8);
    drawGrid(ctxOf(canvas), art.grid, art.colors);
    scene.textures.addCanvas(key, canvas);
  }
  POOF_FRAMES.forEach((frame, i) => {
    const key = `poof-${i}`;
    if (scene.textures.exists(key)) return;
    const canvas = makeCanvas(16, 16);
    drawGrid(ctxOf(canvas), frame.grid, frame.colors);
    scene.textures.addCanvas(key, canvas);
  });
}

const BUBBLE_TONES: ReadonlyArray<BubbleTone> = ['speech', 'thought', 'tool', 'alert', 'error'];

export function buildBubbleTextures(scene: Phaser.Scene): void {
  for (const tone of BUBBLE_TONES) {
    const bodyKey = `bubble-${tone}`;
    if (scene.textures.exists(bodyKey)) continue;
    const colors = bubbleColors(tone);
    const body = makeCanvas(BUBBLE_GRID[0]!.length, BUBBLE_GRID.length);
    drawGrid(ctxOf(body), BUBBLE_GRID, colors);
    scene.textures.addCanvas(bodyKey, body);
    const tail = makeCanvas(BUBBLE_TAIL[0]!.length, BUBBLE_TAIL.length);
    drawGrid(ctxOf(tail), BUBBLE_TAIL, colors);
    scene.textures.addCanvas(`bubble-tail-${tone}`, tail);
  }
}

/** A soft elliptical drop shadow every actor stands on. */
export function buildShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('actor-shadow')) return;
  const canvas = makeCanvas(14, 5);
  const ctx = ctxOf(canvas);
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(7, 2.5, 6.5, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  scene.textures.addCanvas('actor-shadow', canvas);
}

/** A green selection ring shown under the selected actor. */
export function buildSelectTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('actor-select')) return;
  const canvas = makeCanvas(18, 8);
  const ctx = ctxOf(canvas);
  ctx.strokeStyle = PALETTE.screenGlow;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(9, 4, 7.5, 2.8, 0, 0, Math.PI * 2);
  ctx.stroke();
  scene.textures.addCanvas('actor-select', canvas);
}

/**
 * Build (once) the 22-frame sheet for a look and register its animations.
 * Returns the texture key.
 */
export function ensureCharTexture(scene: Phaser.Scene, lookIdx: number): string {
  const key = `char-${lookIdx}`;
  if (scene.textures.exists(key)) return key;
  const look = LOOKS[lookIdx % LOOKS.length]!;
  const colors = charColors(look);
  const canvas = makeCanvas(FRAME_ORDER.length * CHAR_W, CHAR_H);
  const ctx = ctxOf(canvas);
  FRAME_ORDER.forEach((frame, i) => {
    drawGrid(ctx, BODY_FRAMES[frame], colors, i * CHAR_W, 0);
    const hair = HAIR_STYLES[hairFacingOf(frame)][look.hairStyle % 4];
    if (hair) drawGrid(ctx, hair, colors, i * CHAR_W, 0);
  });
  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) return key;
  FRAME_ORDER.forEach((frame, i) => {
    texture.add(frame, 0, i * CHAR_W, 0, CHAR_W, CHAR_H);
  });

  const anim = (animKey: string, frames: BodyFrameName[], frameRate: number) => {
    if (scene.anims.exists(animKey)) return;
    scene.anims.create({
      key: animKey,
      frames: frames.map((f) => ({ key, frame: f })),
      frameRate,
      repeat: -1,
    });
  };
  anim(`walk-down-${lookIdx}`, ['walkDown1', 'walkDown2', 'walkDown3', 'walkDown4'], 8);
  anim(`walk-up-${lookIdx}`, ['walkUp1', 'walkUp2', 'walkUp3', 'walkUp4'], 8);
  anim(`walk-right-${lookIdx}`, ['walkRight1', 'walkRight2', 'walkRight3', 'walkRight4'], 8);
  anim(`type-${lookIdx}`, ['typeUp1', 'typeUp2'], 5);
  anim(`idle-down-${lookIdx}`, ['idleDown', 'idleDown', 'idleDown2', 'blinkDown'], 1.6);
  return key;
}

/** Static (non-animated) frame for a seated/idle pose. */
export function poseFrame(facing: Facing, seated: boolean): { frame: BodyFrameName; flipX: boolean } {
  if (seated) {
    if (facing === 'up') return { frame: 'sitUp', flipX: false };
    if (facing === 'down') return { frame: 'sitDown', flipX: false };
    return { frame: 'sitRight', flipX: facing === 'left' };
  }
  if (facing === 'up') return { frame: 'idleUp', flipX: false };
  if (facing === 'down') return { frame: 'idleDown', flipX: false };
  return { frame: 'idleRight', flipX: facing === 'left' };
}

export function buildPoofAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists('poof')) return;
  scene.anims.create({
    key: 'poof',
    frames: [0, 1, 2].map((i) => ({ key: `poof-${i}` })),
    frameRate: 10,
    repeat: 0,
  });
}

export function buildAllStaticTextures(scene: Phaser.Scene): void {
  buildWorldTexture(scene);
  buildPropTextures(scene);
  buildIconTextures(scene);
  buildBubbleTextures(scene);
  buildShadowTexture(scene);
  buildSelectTexture(scene);
  buildPoofAnim(scene);
}

/** The map is the static-world source; re-exported for the scene. */
export { OFFICE_MAP, renderGrid };
export type { PropName };
