/**
 * The Phaser scene — a thin renderer over the pure {@link OfficeDirector}.
 * create() paints the static world + props from the map's renderGrid();
 * update() advances the director, mirrors its ActorSnapshots into
 * {@link SpriteActor}s, and plays one-shot effects (poofs, monitor glow).
 * The scene never reads moxxy stores and the director never sees Phaser.
 */

import Phaser from 'phaser';

import type { OfficeDirector } from '../sim/director.js';
import { TILE, type SceneEffect } from '../sim/types.js';
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

    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0) this.callbacks.onBackgroundClick?.();
    });

    this.cameras.main.setBounds(0, 0, Number(this.game.config.width), Number(this.game.config.height));
    this.cameras.main.setRoundPixels(true);
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
