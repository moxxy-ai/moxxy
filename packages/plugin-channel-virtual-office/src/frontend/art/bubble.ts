/**
 * Speech bubble: an 18×14 rounded rect that is 9-slice safe — everything
 * strictly inside the 6px slice margins is uniform fill, so the renderer can
 * stretch the middle without artifacts. The 'h' highlight hugs the inner
 * top-left edge and stays inside the corner slices.
 */

import type { ColorMap, PixelGrid } from './pixel.js';

export const BUBBLE_GRID: PixelGrid = [
  '..OOOOOOOOOOOOOO..',
  '.OhhhhFFFFFFFFFFO.',
  '.OhFFFFFFFFFFFFFO.',
  '.OhFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '.OFFFFFFFFFFFFFFO.',
  '..OOOOOOOOOOOOOO..',
];

export const BUBBLE_TAIL: PixelGrid = [
  'OFFFFFO',
  '.OFFFO.',
  '..OFFO.',
  '..OFO..',
  '...O...',
];

export function bubbleColors(tone: 'speech' | 'thought' | 'tool' | 'alert' | 'error'): ColorMap {
  switch (tone) {
    case 'speech':
      return { O: 'ink', F: 'white', h: 'white' };
    case 'thought':
      return { O: 'inkSoft', F: 'white', h: 'white' };
    case 'tool':
      return { O: 'grayDark', F: 'paper', h: 'white' };
    case 'alert':
      return { O: 'yellowDark', F: 'yellow', h: 'white' };
    case 'error':
      return { O: 'redDark', F: 'white', h: 'white' };
  }
}
