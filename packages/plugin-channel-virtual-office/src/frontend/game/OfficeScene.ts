/**
 * The Phaser scene — a thin renderer over the pure {@link OfficeDirector}.
 * create() paints the static world + props from the map's renderGrid();
 * update() advances the director, mirrors its ActorSnapshots into
 * {@link SpriteActor}s, and plays one-shot effects (poofs, monitor glow).
 * The scene never reads moxxy stores and the director never sees Phaser.
 */

import Phaser from 'phaser';

import type { OfficeDirector } from '../sim/director.js';
import { MAP_H, MAP_W, TILE, type SceneEffect } from '../sim/types.js';
import { ZONES } from '../map/zones.js';
import { buildAllStaticTextures, renderGrid } from './textures.js';
import { SpriteActor } from './SpriteActor.js';

export interface OfficeSceneCallbacks {
  onActorClick(id: string): void;
  /** Click on empty floor — clears the selection. */
  onBackgroundClick?(): void;
}

export class OfficeScene extends Phaser.Scene {
  private readonly actors = new Map<string, SpriteActor>();
  private monitors = new Map<number, Phaser.GameObjects.Image>();
  private readonly monitorsOn = new Set<number>();
  private monitorFlip = false;
  private monitorTimer = 0;
  private selectedId: string | null = null;
  /** Zoom at which the whole office exactly fits the window — the floor of
   *  the user's zoom range and the default view. */
  private fitZoom = 1;
  private drag: { x: number; y: number; scrollX: number; scrollY: number } | null = null;

  constructor(
    private readonly director: OfficeDirector,
    private readonly callbacks: OfficeSceneCallbacks,
  ) {
    super('office');
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  create(): void {
    buildAllStaticTextures(this);

    this.add.image(0, 0, 'world').setOrigin(0, 0).setDepth(-1000);

    // Props as individually depth-sorted images (so actors can pass behind a
    // plant but in front of a desk). Bottom-anchored on their map tile.
    const grid = renderGrid();
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y]!.length; x++) {
        const prop = grid[y]![x]!.prop;
        if (!prop) continue;
        const img = this.add
          .image(x * TILE, y * TILE + TILE, `prop-${prop}`)
          .setOrigin(0, 1)
          .setDepth(y * TILE + TILE - 4); // slightly behind an actor standing on the same row
        this.indexMonitor(x, y, img);
      }
    }

    // A click on empty floor (not a drag — pointer barely moved) deselects.
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0 && p.getDistance() < 6) this.callbacks.onBackgroundClick?.();
    });

    this.wireCameraControls();

    this.cameras.main.setRoundPixels(true);
    this.fitCamera(true);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera(false));
  }

  /**
   * Recompute the fit-the-whole-office zoom. `reset` (boot) snaps to it; on
   * window resizes we keep the user's zoom (re-clamped) unless they were AT
   * the fit view, which then follows the new window size.
   */
  private fitCamera(reset: boolean): void {
    const cam = this.cameras.main;
    const wasAtFit = Math.abs(cam.zoom - this.fitZoom) < 0.001;
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    // Never below 1 (unreadably small) — tiny windows scroll-crop instead.
    this.fitZoom = Math.max(
      1,
      Math.min(this.scale.width / worldW, this.scale.height / worldH),
    );
    if (reset || wasAtFit) {
      cam.setZoom(this.fitZoom);
      cam.centerOn(worldW / 2, worldH / 2);
    }
    this.clampCamera();
  }

  /** Wheel (and macOS trackpad pinch, which arrives as ctrl+wheel) zooms
   *  anchored at the cursor; dragging pans. Sprite clicks stay intact —
   *  actors react on pointerUP with a small movement threshold. */
  private wireCameraControls(): void {
    const cam = this.cameras.main;

    this.input.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _over: unknown[], _dx: number, dy: number) => {
        const z1 = cam.zoom;
        const z2 = Phaser.Math.Clamp(z1 * Math.exp(-dy * 0.0015), this.fitZoom, 8);
        if (z2 === z1) return;
        // Keep the world point under the cursor fixed. Phaser's visible rect
        // is centered on (scroll + half-viewport) and sized viewport/zoom, so
        // the world point under screen (px, py) is
        //   w = scroll + half - half/zoom + p/zoom
        // — solve for the new scroll that keeps w in place at the new zoom.
        const halfW = cam.width / 2;
        const halfH = cam.height / 2;
        const wx = cam.scrollX + halfW - halfW / z1 + pointer.x / z1;
        const wy = cam.scrollY + halfH - halfH / z1 + pointer.y / z1;
        cam.setZoom(z2);
        cam.scrollX = wx - halfW + halfW / z2 - pointer.x / z2;
        cam.scrollY = wy - halfH + halfH / z2 - pointer.y / z2;
        this.clampCamera();
      },
    );

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.drag = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      cam.scrollX = this.drag.scrollX - (p.x - this.drag.x) / cam.zoom;
      cam.scrollY = this.drag.scrollY - (p.y - this.drag.y) / cam.zoom;
      this.clampCamera();
    });
    const endDrag = () => {
      this.drag = null;
    };
    this.input.on('pointerup', endDrag);
    this.input.on('pointerupoutside', endDrag);
  }

  /** Keep the office on screen. Phaser's visible world rect is CENTERED on
   *  (scroll + half-viewport) and sized viewport/zoom — clamp that midpoint so
   *  the view stays on the map, or pin it to the map center on any axis where
   *  the view is larger than the map (letterbox). */
  private clampCamera(): void {
    const cam = this.cameras.main;
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const midX =
      viewW >= worldW
        ? worldW / 2
        : Phaser.Math.Clamp(cam.scrollX + cam.width / 2, viewW / 2, worldW - viewW / 2);
    const midY =
      viewH >= worldH
        ? worldH / 2
        : Phaser.Math.Clamp(cam.scrollY + cam.height / 2, viewH / 2, worldH - viewH / 2);
    cam.scrollX = midX - cam.width / 2;
    cam.scrollY = midY - cam.height / 2;
  }

  private indexMonitor(x: number, y: number, img: Phaser.GameObjects.Image): void {
    for (const office of ZONES.offices) {
      if (office.monitorTile.x === x && office.monitorTile.y === y) {
        this.monitors.set(office.index, img);
      }
    }
  }

  override update(time: number, delta: number): void {
    this.director.update(delta);

    // Mirror actor snapshots → sprites.
    const seen = new Set<string>();
    for (const snapshot of this.director.actors()) {
      seen.add(snapshot.id);
      let actor = this.actors.get(snapshot.id);
      if (!actor) {
        actor = new SpriteActor(this, snapshot, (id) => this.callbacks.onActorClick(id));
        this.actors.set(snapshot.id, actor);
      }
      actor.sync(snapshot, time, snapshot.id === this.selectedId);
    }
    for (const [id, actor] of this.actors) {
      if (seen.has(id)) continue;
      this.actors.delete(id);
      actor.destroyActor();
    }

    for (const effect of this.director.drainEffects()) this.playEffect(effect);

    // Animate glowing monitors (2-frame code scroll).
    this.monitorTimer += delta;
    if (this.monitorTimer > 400) {
      this.monitorTimer = 0;
      this.monitorFlip = !this.monitorFlip;
      for (const index of this.monitorsOn) {
        this.monitors.get(index)?.setTexture(
          `prop-${this.monitorFlip ? 'deskMonitorOn1' : 'deskMonitorOn2'}`,
        );
      }
    }
  }

  private playEffect(effect: SceneEffect): void {
    if (effect.kind === 'poof') {
      const poof = this.add
        .sprite(effect.at.x * TILE + TILE / 2, effect.at.y * TILE + TILE / 2, 'poof-0')
        .setDepth(effect.at.y * TILE + TILE + 1);
      poof.play('poof');
      poof.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => poof.destroy());
      return;
    }
    if (effect.kind === 'monitor') {
      const img = this.monitors.get(effect.officeIndex);
      if (!img) return;
      if (effect.on) {
        this.monitorsOn.add(effect.officeIndex);
        img.setTexture('prop-deskMonitorOn1');
      } else {
        this.monitorsOn.delete(effect.officeIndex);
        img.setTexture('prop-deskMonitor');
      }
    }
  }
}
