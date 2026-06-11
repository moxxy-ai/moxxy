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

export function createGame(
  parent: HTMLElement,
  director: OfficeDirector,
  callbacks: OfficeSceneCallbacks,
): OfficeGame {
  const scene = new OfficeScene(director, callbacks);
  // The canvas fills the window (Scale.RESIZE) and the CAMERA zooms the
  // 704×480 world to exactly fit — scaling happens in the renderer with
  // nearest-neighbor sampling, so the art stays crisp at any window size
  // (unlike Scale.FIT/NONE, which either CSS-blur or letterbox to a stamp).
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0f1115',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: MAP_W * TILE,
      height: MAP_H * TILE,
    },
    scene,
  });
  // Debug handle for headless smoke probes (harmless in production).
  (window as unknown as Record<string, unknown>).__officeGame = game;
  return { game, scene };
}
