/**
 * Phaser boot: a fixed 704×480 pixel world, integer-scaled up to fit the
 * window (pixelArt keeps everything crisp).
 */

import Phaser from 'phaser';

import { MAP_H, MAP_W, TILE } from '../sim/types.js';
import type { OfficeDirector } from '../sim/director.js';
import { OfficeScene, type OfficeSceneCallbacks } from './OfficeScene.js';

export interface OfficeGame {
  readonly game: Phaser.Game;
  readonly scene: OfficeScene;
}

/** Largest integer zoom that fits the window — non-integer scaling blurs
 *  the pixel art (and especially the bubble text). */
function bestZoom(): number {
  return Math.max(
    1,
    Math.min(
      Math.floor(window.innerWidth / (MAP_W * TILE)),
      Math.floor(window.innerHeight / (MAP_H * TILE)),
    ),
  );
}

export function createGame(
  parent: HTMLElement,
  director: OfficeDirector,
  callbacks: OfficeSceneCallbacks,
): OfficeGame {
  const scene = new OfficeScene(director, callbacks);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: MAP_W * TILE,
    height: MAP_H * TILE,
    backgroundColor: '#0f1115',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      zoom: bestZoom(),
    },
    scene,
  });
  window.addEventListener('resize', () => game.scale.setZoom(bestZoom()));
  return { game, scene };
}
