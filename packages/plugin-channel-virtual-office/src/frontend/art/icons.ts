/**
 * Status icons (8×8, bold shapes that read at 2× zoom) and the 3-frame
 * cartoon poof (16×16) used when an agent appears/vanishes.
 */

import type { ColorMap, PixelGrid } from './pixel.js';

export interface IconArt {
  readonly grid: PixelGrid;
  readonly colors: ColorMap;
}

export type IconName = 'alert' | 'tool' | 'zzz' | 'coffee' | 'denied';

export const ICON_ART: Readonly<Record<IconName, IconArt>> = {
  /** Yellow exclamation mark with an ink outline. */
  alert: {
    grid: [
      '...OO...',
      '..OYYO..',
      '..OYYO..',
      '..OYYO..',
      '...OO...',
      '..OYYO..',
      '...OO...',
      '........',
    ],
    colors: { O: 'ink', Y: 'yellow' },
  },
  /** Gray wrench, head top-left, handle running down-right. */
  tool: {
    grid: [
      '.OO.OO..',
      'OMMOMMO.',
      'OMMMMMO.',
      '.OMMMO..',
      '..OMMO..',
      '...OMMO.',
      '....OMMO',
      '.....OO.',
    ],
    colors: { O: 'ink', M: 'metalLight' },
  },
  /** Three blue Z's drifting up to the right. */
  zzz: {
    grid: [
      'BB...BBB',
      'B.....B.',
      'BB...BBB',
      '........',
      '.BBBB...',
      '...B....',
      '..B.....',
      '.BBBB...',
    ],
    colors: { B: 'blue' },
  },
  /** White cup with rising steam. */
  coffee: {
    grid: [
      '..a.a...',
      '.a.a....',
      '........',
      '.OWWWWO.',
      '.OWWWWOO',
      '.OWWWWO.',
      '..OOOO..',
      '........',
    ],
    colors: { O: 'ink', W: 'white', a: 'gray' },
  },
  /** Red ✗. */
  denied: {
    grid: [
      '.O....O.',
      'ORO..ORO',
      '.OROORO.',
      '..ORRO..',
      '..ORRO..',
      '.OROORO.',
      'ORO..ORO',
      '.O....O.',
    ],
    colors: { O: 'ink', R: 'red' },
  },
};

const POOF_COLORS: ColorMap = { W: 'white', a: 'gray', d: 'grayDark' };

/** Classic expanding dust puff: dense → breaking ring → sparse wisps. */
export const POOF_FRAMES: ReadonlyArray<IconArt> = [
  {
    grid: [
      '................',
      '................',
      '................',
      '................',
      '.......WW.......',
      '......WWWW......',
      '.....WWWWWW.....',
      '.....WWaaWW.....',
      '.....WWWWWW.....',
      '......WWWW......',
      '.......WW.......',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    colors: POOF_COLORS,
  },
  {
    grid: [
      '................',
      '................',
      '......aaaa......',
      '....aaWWWWaa....',
      '...aWWWWWWWWa...',
      '...aWWaaaaWWa...',
      '..aWWaa..aaWWa..',
      '..aWa......aWa..',
      '..aWWaa..aaWWa..',
      '...aWWaaaaWWa...',
      '...aWWWWWWWWa...',
      '....aaWWWWaa....',
      '......aaaa......',
      '................',
      '................',
      '................',
    ],
    colors: POOF_COLORS,
  },
  {
    grid: [
      '................',
      '...aa......aa...',
      '..add......dda..',
      '..da........ad..',
      '................',
      '.dd..........dd.',
      '.d............d.',
      '................',
      '................',
      '.d............d.',
      '.dd..........dd.',
      '................',
      '..da........ad..',
      '..add......dda..',
      '...aa......aa...',
      '................',
    ],
    colors: POOF_COLORS,
  },
];
