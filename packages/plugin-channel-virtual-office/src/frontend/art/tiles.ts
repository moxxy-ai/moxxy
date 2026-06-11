/**
 * Ground + wall tiles, all exactly 16×16. Floors carry sparse dither/texture
 * pixels so large areas don't read flat; walls are split into a dark `wallTop`
 * cap (seen from above) and a cream `wallFace` (the south-facing front).
 * Floor tiles have no outline — only free-standing props get ink silhouettes.
 */

import type { ColorMap, PixelGrid } from './pixel.js';

export interface TileArt {
  readonly grid: PixelGrid;
  readonly colors: ColorMap;
}

export type TileName =
  | 'floorWood'
  | 'floorWoodAlt'
  | 'carpet'
  | 'carpetAlt'
  | 'rug'
  | 'wallTop'
  | 'wallFace'
  | 'window'
  | 'glassFace'
  | 'doorway'
  | 'entranceMat';

const FLOOR_COLORS: ColorMap = {
  L: 'floorLight',
  f: 'floor',
  s: 'floorShade',
  d: 'floorLine',
};

/** Warm plank floor: light catch row per plank, seams offset per plank. */
const FLOOR_WOOD: PixelGrid = [
  'LLLLLLLLLLLdLLLL',
  'ffffsffffffdffff',
  'fffffffffffdffsf',
  'dddddddddddddddd',
  'LLLLdLLLLLLLLLLL',
  'ffffdfffffsfffff',
  'ffffdffffffffsff',
  'dddddddddddddddd',
  'LLLLLLLLLLLLLdLL',
  'ffsffffffffffdff',
  'fffffffsfffffdff',
  'dddddddddddddddd',
  'LLLLLLdLLLLLLLLL',
  'ffffffdfffsfffff',
  'ffffffdffffffffs',
  'dddddddddddddddd',
];

const FLOOR_WOOD_ALT: PixelGrid = [
  'LLLLLLdLLLLLLLLL',
  'ffffffdffddfffff',
  'ffffffdffffffsff',
  'dddddddddddddddd',
  'LLLLLLLLLLLLdLLL',
  'ffsfffffffffdfff',
  'ffffffffsfffdfff',
  'dddddddddddddddd',
  'LLLdLLLLLLLLLLLL',
  'fffdffffffsfffff',
  'fffdffffffffddff',
  'dddddddddddddddd',
  'LLLLLLLLLdLLLLLL',
  'fffffsfffdffffff',
  'fffffffffdfffsff',
  'dddddddddddddddd',
];

const CARPET_COLORS: ColorMap = {
  c: 'carpet',
  l: 'carpetLight',
  h: 'carpetShade',
};

/** Cool blue-gray carpet with an 8px-period weave of light/shade dots. */
const CARPET: PixelGrid = [
  'cccccccccccccccc',
  'cclccccccclccccc',
  'cccccccccccccccc',
  'cccccchccccccchc',
  'cccccccccccccccc',
  'cccccclccccccclc',
  'cccccccccccccccc',
  'cchccccccchccccc',
  'cccccccccccccccc',
  'cclccccccclccccc',
  'cccccccccccccccc',
  'cccccchccccccchc',
  'cccccccccccccccc',
  'cccccclccccccclc',
  'cccccccccccccccc',
  'cchccccccchccccc',
];

const CARPET_ALT: PixelGrid = [
  'cccccccccccccccc',
  'cccccccccccccccc',
  'cchccccccchccccc',
  'cccccccccccccccc',
  'cccccclccccccclc',
  'cccccccccccccccc',
  'cclccccccclccccc',
  'cccccccccccccccc',
  'cccccccccccccccc',
  'cccccccccccccccc',
  'cchccccccchccccc',
  'cccccccccccccccc',
  'cccccclccccccclc',
  'cccccccccccccccc',
  'cclccccccclccccc',
  'cccccccccccccccc',
];

/** Warm red rug with an 8px-period diamond motif (tiles seamlessly). */
const RUG: PixelGrid = [
  'rrrrrrrrrrrrrrrr',
  'rrrRrrrrrrrRrrrr',
  'rrRrRrrrrrRrRrrr',
  'rrrRrrrrrrrRrrrr',
  'rrrrrrrrrrrrrrrr',
  'rrrrrrrRrrrrrrrR',
  'RrrrrrRrRrrrrrRr',
  'rrrrrrrRrrrrrrrR',
  'rrrrrrrrrrrrrrrr',
  'rrrRrrrrrrrRrrrr',
  'rrRrRrrrrrRrRrrr',
  'rrrRrrrrrrrRrrrr',
  'rrrrrrrrrrrrrrrr',
  'rrrrrrrRrrrrrrrR',
  'RrrrrrRrRrrrrrRr',
  'rrrrrrrRrrrrrrrR',
];

const WALL_TOP: PixelGrid = [
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'kkkkkkkkkkkkkkkk',
];

/** Cream face: lit top row, vertical seams every ~5px, 2px baseboard. */
const WALL_FACE: PixelGrid = [
  'WWWWWWWWWWWWWWWW',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'FFSFFFFSFFFFSFFF',
  'SSSSSSSSSSSSSSSS',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
];

/** wallFace with an inset 10×8 pane: woodDark frame, diagonal glass sheen. */
const WINDOW: PixelGrid = [
  'WWWWWWWWWWWWWWWW',
  'FFFFFFFFFFFFFFFF',
  'FFDDDDDDDDDDDDFF',
  'FFDgggggggGGgDFF',
  'FFDggggggGGggDFF',
  'FFDgggggGGgggDFF',
  'FFDggggGGggggDFF',
  'FFDgggGGgggggDFF',
  'FFDggGGggggggDFF',
  'FFDgGGgggggggDFF',
  'FFDGGggggggggDFF',
  'FFDDDDDDDDDDDDFF',
  'FFFFFFFFFFFFFFFF',
  'SSSSSSSSSSSSSSSS',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
];

/** Interior glass partition: metal rails top/bottom, long diagonal sheen. */
const GLASS_FACE: PixelGrid = [
  'MMMMMMMMMMMMMMMM',
  'mmmmmmmmmmmmmmmm',
  'ggggggggggggGGgg',
  'gggggggggggGGggg',
  'ggggggggggGGgggg',
  'gggggggggGGggggg',
  'ggggggggGGgggggg',
  'gggggggGGggggggg',
  'ggggggGGgggggggg',
  'gggggGGggggggggg',
  'ggggGGgggggggggg',
  'gggGGggggggggggg',
  'ggGGgggggggggggg',
  'gGGggggggggggggg',
  'mmmmmmmmmmmmmmmm',
  'dddddddddddddddd',
];

/** floorWood with a dark wood threshold strip across the opening. */
const DOORWAY: PixelGrid = [
  'LLLLLLLLLLLdLLLL',
  'ffffsffffffdffff',
  'fffffffffffdffsf',
  'dddddddddddddddd',
  'LLLLdLLLLLLLLLLL',
  'oooooooooooooooo',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'LLLLLLLLLLLLLdLL',
  'ffsffffffffffdff',
  'fffffffsfffffdff',
  'dddddddddddddddd',
  'LLLLLLdLLLLLLLLL',
  'ffffffdfffsfffff',
  'ffffffdffffffffs',
  'dddddddddddddddd',
];

/** Gray doormat with a grayDark border, on a floorWood surround. */
const ENTRANCE_MAT: PixelGrid = [
  'ffffffffffffffff',
  'fDDDDDDDDDDDDDDf',
  'fDGGGGGGGGGGGGDf',
  'fDGGGGGGGGGGGGDf',
  'fDGGDGGGGGDGGGDf',
  'fDGGGGGGGGGGGGDf',
  'fDGGGGGDGGGGGGDf',
  'fDGGGGGGGGGGGGDf',
  'fDGGDGGGGGDGGGDf',
  'fDGGGGGGGGGGGGDf',
  'fDGGGGGDGGGGGGDf',
  'fDGGGGGGGGGGGGDf',
  'fDGGDGGGGGDGGGDf',
  'fDGGGGGGGGGGGGDf',
  'fDDDDDDDDDDDDDDf',
  'ffffffffffffffff',
];

export const TILE_ART: Readonly<Record<TileName, TileArt>> = {
  floorWood: { grid: FLOOR_WOOD, colors: FLOOR_COLORS },
  floorWoodAlt: { grid: FLOOR_WOOD_ALT, colors: FLOOR_COLORS },
  carpet: { grid: CARPET, colors: CARPET_COLORS },
  carpetAlt: { grid: CARPET_ALT, colors: CARPET_COLORS },
  rug: { grid: RUG, colors: { r: 'rug', R: 'rugLight' } },
  wallTop: { grid: WALL_TOP, colors: { w: 'wallTop', k: 'inkSoft' } },
  wallFace: {
    grid: WALL_FACE,
    colors: { W: 'white', F: 'wallFace', S: 'wallFaceShade', B: 'wallBase' },
  },
  window: {
    grid: WINDOW,
    colors: {
      W: 'white',
      F: 'wallFace',
      S: 'wallFaceShade',
      B: 'wallBase',
      D: 'woodDark',
      g: 'glass',
      G: 'glassLight',
    },
  },
  glassFace: {
    grid: GLASS_FACE,
    colors: { M: 'metalLight', m: 'metal', d: 'metalDark', g: 'glass', G: 'glassLight' },
  },
  doorway: {
    grid: DOORWAY,
    colors: { ...FLOOR_COLORS, o: 'wood', D: 'woodDark' },
  },
  entranceMat: {
    grid: ENTRANCE_MAT,
    colors: { f: 'floor', G: 'gray', D: 'grayDark' },
  },
};
