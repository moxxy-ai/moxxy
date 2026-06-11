/**
 * Time-based tile-to-tile movement. A Mover owns a pixel position (the
 * actor's FEET — bottom-center anchor: x = tileX*16+8, y = tileY*16+16 when
 * resting on a tile) and interpolates along a tile path produced by A*.
 * Pure: advances only via update(dtMs).
 */

import { TILE, tileCenterPx } from './types.js';
import type { Facing, Vec2 } from './types.js';

/** Forgives float dust when deciding a segment is complete (px). */
const ARRIVE_EPSILON = 1e-6;

export interface MoverState {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly moving: boolean;
}

export class Mover {
  private x: number;
  private y: number;
  private facingDir: Facing = 'down';
  /** Pixel-space waypoint targets (tile centers). */
  private waypoints: Vec2[] = [];
  private idx = 0;
  private onArriveCb: (() => void) | undefined;
  private readonly pxPerMs: number;

  constructor(startTile: Vec2, speedTilesPerSec = 4) {
    const p = tileCenterPx(startTile);
    this.x = p.x;
    this.y = p.y;
    this.pxPerMs = (speedTilesPerSec * TILE) / 1000;
  }

  /** Replaces the current path. `path` is a tile list (usually from A*). */
  setPath(path: ReadonlyArray<Vec2>, onArrive?: () => void): void {
    this.waypoints = path.map((t) => tileCenterPx(t));
    this.idx = 0;
    this.onArriveCb = onArrive;
  }

  /** Halt at the current pixel position; pending onArrive never fires. */
  stop(): void {
    this.waypoints = [];
    this.idx = 0;
    this.onArriveCb = undefined;
  }

  teleport(tile: Vec2): void {
    const p = tileCenterPx(tile);
    this.x = p.x;
    this.y = p.y;
    this.stop();
  }

  /** Nearest tile to the current pixel position. */
  get tile(): Vec2 {
    return { x: Math.round(this.x / TILE - 0.5), y: Math.round(this.y / TILE - 1) };
  }

  get state(): MoverState {
    return {
      x: this.x,
      y: this.y,
      facing: this.facingDir,
      moving: this.idx < this.waypoints.length,
    };
  }

  update(dtMs: number): void {
    if (this.idx >= this.waypoints.length) return;
    let budget = dtMs * this.pxPerMs; // distance budget — may cross several tiles
    while (budget > 0 && this.idx < this.waypoints.length) {
      const t = this.waypoints[this.idx];
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= budget + ARRIVE_EPSILON) {
        if (dx !== 0) this.facingDir = dx > 0 ? 'right' : 'left';
        else if (dy !== 0) this.facingDir = dy > 0 ? 'down' : 'up';
        this.x = t.x;
        this.y = t.y;
        budget -= dist;
        this.idx++;
      } else {
        // Partial step within a segment: consume x first, then y (segments
        // are axis-aligned tile hops, so at most one axis is nonzero).
        const stepX = Math.sign(dx) * Math.min(Math.abs(dx), budget);
        if (stepX !== 0) {
          this.x += stepX;
          budget -= Math.abs(stepX);
          this.facingDir = stepX > 0 ? 'right' : 'left';
        }
        if (budget > 0 && dy !== 0) {
          const stepY = Math.sign(dy) * Math.min(Math.abs(dy), budget);
          this.y += stepY;
          this.facingDir = stepY > 0 ? 'down' : 'up';
        }
        budget = 0;
      }
    }
    if (this.idx >= this.waypoints.length) {
      this.waypoints = [];
      this.idx = 0;
      const cb = this.onArriveCb;
      this.onArriveCb = undefined;
      cb?.(); // fires exactly once, on the update() that reaches the last tile
    }
  }
}
