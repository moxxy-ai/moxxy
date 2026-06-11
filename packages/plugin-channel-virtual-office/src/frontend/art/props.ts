/**
 * Furniture + device sprites. Props are bottom-anchored: their base sits on
 * the map tile; 16×24 props extend 8px upward into the tile above. Every
 * free-standing prop gets a 1px ink silhouette outline; tops are lit (light
 * source top-left), fronts use the darker ramp colors.
 *
 * The monitor desks are composed in code: an overlay applied to the plain
 * deskRight grid, so the three monitor frames are pixel-identical everywhere
 * except the screen glyphs (the renderer flips between them to "type code").
 */

import type { ColorMap, PixelGrid } from './pixel.js';
import { isTransparent } from './pixel.js';

export interface PropArt {
  readonly grid: PixelGrid;
  readonly colors: ColorMap;
  readonly w: 16;
  readonly h: 16 | 24;
}

export type PropName =
  | 'deskLeft'
  | 'deskRight'
  | 'deskMonitor'
  | 'deskMonitorOn1'
  | 'deskMonitorOn2'
  | 'chairDown'
  | 'chairUp'
  | 'chairLeft'
  | 'chairRight'
  | 'confTL'
  | 'confT'
  | 'confTR'
  | 'confBL'
  | 'confB'
  | 'confBR'
  | 'plantBig'
  | 'plantSmall'
  | 'coffeeMachine1'
  | 'coffeeMachine2'
  | 'waterCooler1'
  | 'waterCooler2'
  | 'bookshelf'
  | 'printer'
  | 'whiteboard';

/** Overlay `top` onto `base`: transparent overlay pixels keep the base. */
function merge(base: PixelGrid, top: PixelGrid): PixelGrid {
  return base.map((row, y) => {
    const over = top[y];
    if (!over) return row;
    let out = '';
    for (let x = 0; x < row.length; x++) {
      const ch = over[x] ?? '.';
      out += isTransparent(ch) ? row[x]! : ch;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Desks — a 2-tile-wide wooden desk; the halves join seamlessly at the seam.

const DESK_COLORS: ColorMap = {
  O: 'ink',
  T: 'woodLight',
  w: 'wood',
  D: 'woodDark',
  P: 'paper',
};

const DESK_LEFT: PixelGrid = [
  '................',
  '................',
  '.OOOOOOOOOOOOOOO',
  '.OTTTTTTTTTTTTTT',
  '.OTTPPPTTTTTTTTT',
  '.OTTPPPTTTTTTTTT',
  '.OTTTTTTTTwwTTTT',
  '.OTTTTTTTTTTTTTT',
  '.Owwwwwwwwwwwwww',
  '.Owwwwwwwwwwwwww',
  '.Owwwwwwwwwwwwww',
  '.ODDDDDDDDDDDDDD',
  '.OOOOOOOOOOOOOOO',
  '..ODD...........',
  '..ODD...........',
  '..ODD...........',
];

const DESK_RIGHT: PixelGrid = [
  '................',
  '................',
  'OOOOOOOOOOOOOOO.',
  'TTTTTTTTTTTTTTO.',
  'TTTTTTTTTTTTwwO.',
  'TTTTTTTTTTTTTTO.',
  'TTTTTTTTTTTTTTO.',
  'TTTTTTTTTTTTTTO.',
  'wwwwwwwwwwwwwwO.',
  'wwwwwwwwwwwwwwO.',
  'wwwwwwwwwwwwwwO.',
  'DDDDDDDDDDDDDDO.',
  'OOOOOOOOOOOOOO..',
  '...........DDO..',
  '...........DDO..',
  '...........DDO..',
];

/** Monitor overlay rows (rows 0-7); '.' keeps the desk pixel underneath. */
function monitorOverlay(mode: 'off' | 'on1' | 'on2'): PixelGrid {
  const screen: Record<'off' | 'on1' | 'on2', readonly [string, string, string, string]> = {
    off: ['cccccc', 'cccccc', 'cccccc', 'cccccc'],
    on1: ['cccccc', 'GGcccc', 'GGGccc', 'cccccc'],
    on2: ['cccccc', 'GGcccc', 'GGGccc', 'cccccc'],
  };
  // on2 shifts the two code lines down one row (frame 2 of the scroll loop).
  const rows = mode === 'on2' ? ['cccccc', 'cccccc', 'GGcccc', 'GGGccc'] : screen[mode];
  return [
    '....OOOOOOOO....',
    `....O${rows[0]}O....`,
    `....O${rows[1]}O....`,
    `....O${rows[2]}O....`,
    `....O${rows[3]}O....`,
    '....OOOOOOOO....',
    '.......mm.......',
    '......mmmm......',
  ];
}

const DESK_MONITOR_COLORS: ColorMap = {
  ...DESK_COLORS,
  c: 'screen',
  G: 'screenGlow',
  m: 'metalDark',
};

// ---------------------------------------------------------------------------
// Office task chairs, 4 facings: a narrow rounded teal backrest, a clearly
// separate seat cushion with a metalLight pan edge, and a splayed 5-star
// metalDark base with metalLight caster dots — so the silhouette says
// "chair on wheels", never "monitor on a stand".

const CHAIR_COLORS: ColorMap = {
  O: 'ink',
  t: 'teal',
  d: 'tealDark',
  M: 'metalLight',
  m: 'metalDark',
};

const CHAIR_BASE: readonly string[] = [
  '.......mm.......',
  '.....mmmmmm.....',
  '..mmm..mm..mmm..',
  '..MM...MM...MM..',
];

const CHAIR_DOWN: PixelGrid = [
  '................',
  '................',
  '................',
  '................',
  '.....OOOOOO.....',
  '....OMttttdO....',
  '....OtttttdO....',
  '....OtttttdO....',
  '....OtdddddO....',
  '..OOOOOOOOOOOO..',
  '..OtttttttttdO..',
  '..OMMMMMMMMMMO..',
  ...CHAIR_BASE,
];

const CHAIR_UP: PixelGrid = [
  '................',
  '................',
  '................',
  '................',
  '.....OOOOOO.....',
  '....OMttttdO....',
  '....OtttttdO....',
  '....OtttttdO....',
  '..OOOOOOOOOOOO..',
  '..OMtttttttttO..',
  '..OtttttttttdO..',
  '..OMMMMMMMMMMO..',
  ...CHAIR_BASE,
];

const CHAIR_RIGHT: PixelGrid = [
  '................',
  '................',
  '................',
  '................',
  '....OO..........',
  '...OMtO.........',
  '...OttO.........',
  '...OtdO.........',
  '...OtdO.........',
  '...OtdOOOOOOOO..',
  '...OttttttttdO..',
  '...OMMMMMMMMMO..',
  ...CHAIR_BASE,
];

const CHAIR_LEFT: PixelGrid = [
  '................',
  '................',
  '................',
  '................',
  '..........OO....',
  '.........OMdO...',
  '.........OtdO...',
  '.........OtdO...',
  '.........OtdO...',
  '..OOOOOOOOtdO...',
  '..OMttttttttO...',
  '..OMMMMMMMMMO...',
  ...CHAIR_BASE,
];

// ---------------------------------------------------------------------------
// Conference table — 3×2 tiles forming a rounded 48×32 top; confT/confB tile
// horizontally so the map can stretch the table wider. Light from top-left:
// a 1px floorLight highlight runs along the top + left inner edges, a wood
// shade column hugs the right edge, sparse wood grain ticks break up the
// woodLight surface, and the B row drops to a 3px woodDark front face.

const CONF_COLORS: ColorMap = {
  O: 'ink',
  L: 'floorLight',
  T: 'woodLight',
  w: 'wood',
  D: 'woodDark',
};

const CONF_TL: PixelGrid = [
  '................',
  '...OOOOOOOOOOOOO',
  '..OLLLLLLLLLLLLL',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTwwTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTwwTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTwwTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
];

const CONF_T: PixelGrid = [
  '................',
  'OOOOOOOOOOOOOOOO',
  'LLLLLLLLLLLLLLLL',
  'TTTTTTTTTTTTTTTT',
  'TTTTwwTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTwwTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTwwTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTwwTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
];

const CONF_TR: PixelGrid = [
  '................',
  'OOOOOOOOOOOOO...',
  'LLLLLLLLLLLLwO..',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTwwTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTwwTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTwwTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
];

const CONF_BL: PixelGrid = [
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTwwTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTwwTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.OLTTTTTTTTTTTTT',
  '.Owwwwwwwwwwwwww',
  '.ODDDDDDDDDDDDDD',
  '.ODDDDDDDDDDDDDD',
  '..ODDDDDDDDDDDDD',
  '...OOOOOOOOOOOOO',
  '...ODD..........',
  '...ODD..........',
  '...ODD..........',
];

const CONF_B: PixelGrid = [
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTwwTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTwwTTT',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'wwwwwwwwwwwwwwww',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'OOOOOOOOOOOOOOOO',
  '................',
  '................',
  '................',
];

const CONF_BR: PixelGrid = [
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTwwTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTwwTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'TTTTTTTTTTTTTwO.',
  'wwwwwwwwwwwwwwO.',
  'DDDDDDDDDDDDDDO.',
  'DDDDDDDDDDDDDDO.',
  'DDDDDDDDDDDDDO..',
  'OOOOOOOOOOOOO...',
  '..........DDO...',
  '..........DDO...',
  '..........DDO...',
];

// ---------------------------------------------------------------------------
// Plants.

const PLANT_COLORS: ColorMap = {
  O: 'ink',
  l: 'leaf',
  L: 'leafLight',
  d: 'leafDark',
  p: 'pot',
  P: 'potLight',
};

const PLANT_BIG: PixelGrid = [
  '....OO....OO....',
  '...OLLO..OllO...',
  '..OLLLLO.OllldO.',
  '..OLLllOOOllldO.',
  '.OLlllllllllldO.',
  '.OlllldlllldllO.',
  '.OllldlllldlllO.',
  '..OllllOOllllO..',
  '..OlldlO.OldlO..',
  '...OOllO.OllOO..',
  '....OldO.OdlO...',
  '.....OdOOOdO....',
  '......OdddO.....',
  '......OdddO.....',
  '......OdddO.....',
  '...OOOOOOOOOO...',
  '...OPPPPppppO...',
  '...OppppppppO...',
  '....OppppppO....',
  '....OppppppO....',
  '....OppppppO....',
  '....OppppppO....',
  '.....OppppO.....',
  '.....OOOOOO.....',
];

const PLANT_SMALL: PixelGrid = [
  '................',
  '................',
  '.....OO..OO.....',
  '....OLlOOllO....',
  '...OLllllldlO...',
  '...OlllldlllO...',
  '...OllldllldO...',
  '....OlldlllO....',
  '.....OOllOO.....',
  '......OddO......',
  '....OOOOOOOO....',
  '....OPPPpppO....',
  '.....OppppO.....',
  '.....OppppO.....',
  '......OppO......',
  '......OOOO......',
];

// ---------------------------------------------------------------------------
// Coffee machine (led blinks between frames) + water cooler (bubble rises).

const COFFEE_COLORS: ColorMap = {
  O: 'ink',
  m: 'metal',
  M: 'metalLight',
  d: 'metalDark',
  c: 'screen',
  R: 'led',
  W: 'white',
};

function coffeeMachine(led: 'R' | 'd'): PixelGrid {
  return [
    '................',
    '................',
    '................',
    '................',
    '...OOOOOOOOOO...',
    '...OMMMMMMMMO...',
    '...OmmmmmmmmO...',
    '...OmmmmmmmmO...',
    `...Omccccm${led}mO...`,
    '...OmccccmmmO...',
    '...OmmmmmmmmO...',
    '...OddmmmmddO...',
    '...OddOOOOddO...',
    '...OdOcddcOdO...',
    '...OdOccccOdO...',
    '...OdOcWWcOdO...',
    '...OdOcWWcOdO...',
    '...OdOOOOOOdO...',
    '...OmmmmmmmmO...',
    '...OmmmmmmmmO...',
    '...OmmmmmmmmO...',
    '...OddddddddO...',
    '...OddddddddO...',
    '...OOOOOOOOOO...',
  ];
}

const WATER_COLORS: ColorMap = {
  O: 'ink',
  g: 'glass',
  G: 'glassLight',
  W: 'white',
  a: 'gray',
  d: 'grayDark',
  B: 'blue',
  R: 'red',
};

function waterCooler(bubbleRow: 4 | 5): PixelGrid {
  const bottle = (y: number): string =>
    y === bubbleRow ? '....OgggGggO....' : '....OggggggO....';
  return [
    '................',
    '....OOOOOOOO....',
    '....OGgggggO....',
    '....OGgggggO....',
    bottle(4),
    bottle(5),
    '....OggggggO....',
    '....OggggggO....',
    '....OOOOOOOO....',
    '...OWWWWWWWWO...',
    '...OWWWWWWWWO...',
    '...OWWWWWWWWO...',
    '...OWBWWWWRWO...',
    '...OWWWWWWWWO...',
    '...OWWWWWWWWO...',
    '...OaWWWWWWaO...',
    '...OaWWWWWWaO...',
    '...OaWWWWWWaO...',
    '...OaWWWWWWaO...',
    '...OaWWWWWWaO...',
    '...OaaWWWWaaO...',
    '...OaaaaaaaaO...',
    '...OddddddddO...',
    '...OOOOOOOOOO...',
  ];
}

// ---------------------------------------------------------------------------
// Bookshelf, printer, whiteboard.

const BOOKSHELF_COLORS: ColorMap = {
  O: 'ink',
  w: 'wood',
  T: 'woodLight',
  D: 'woodDark',
  R: 'red',
  B: 'blue',
  G: 'green',
  Y: 'yellow',
  P: 'purple',
};

const BOOKSHELF: PixelGrid = [
  '.OOOOOOOOOOOOOO.',
  '.OTTTTTTTTTTTTO.',
  '.ODDDDDDDDDDDDO.',
  '.OBBDGGDPPDDYDO.',
  '.OBBRGGYPPDBYBO.',
  '.OBBRGGYPPDBYBO.',
  '.OBBRGGYPPDBYBO.',
  '.OwwwwwwwwwwwwO.',
  '.ODDDDDDDDDDDDO.',
  '.ORDYYDPDDGGDDO.',
  '.ORGYYBPRDGGBPO.',
  '.ORGYYBPRDGGBPO.',
  '.ORGYYBPRDGGBPO.',
  '.OwwwwwwwwwwwwO.',
  '.ODDDDDDDDDDDDO.',
  '.ODBBDGDYBDRRDO.',
  '.OYBBPGRYBDRRGO.',
  '.OYBBPGRYBDRRGO.',
  '.OYBBPGRYBDRRGO.',
  '.OwwwwwwwwwwwwO.',
  '.ODDDDDDDDDDDDO.',
  '.ODDDDDDDDDDDDO.',
  '.OOOOOOOOOOOOOO.',
  '..OO........OO..',
];

const PRINTER: PixelGrid = [
  '................',
  '................',
  '................',
  '................',
  '.....OWWWWO.....',
  '.....OWWWWO.....',
  '..OOOOOOOOOOOO..',
  '..OPPPPPPPPPPO..',
  '..OPPPPPPPPRPO..',
  '..OaaaaaaaaaaO..',
  '..OPPPPPPPPPPO..',
  '..OaaaaaaaaaaO..',
  '..OPWWWWWWWWPO..',
  '..OPddddddddPO..',
  '..OddddddddddO..',
  '..OOOOOOOOOOOO..',
];

const PRINTER_COLORS: ColorMap = {
  O: 'ink',
  P: 'paper',
  a: 'gray',
  d: 'grayDark',
  W: 'white',
  R: 'led',
};

const WHITEBOARD: PixelGrid = [
  '................',
  '.OOOOOOOOOOOOOO.',
  '.OmmmmmmmmmmmmO.',
  '.OmWWWWWWWWWWmO.',
  '.OmWBBBBWWWWWmO.',
  '.OmWWWWWBBBWWmO.',
  '.OmWWWWWWWWWWmO.',
  '.OmWWRRRWWWWWmO.',
  '.OmWWWWWWRRWWmO.',
  '.OmWWWWWWWWWWmO.',
  '.OmWWWWWWWWWWmO.',
  '.OmmmmmmmmmmmmO.',
  '.OOOOOOOOOOOOOO.',
  '....OmRmmBmO....',
  '....OOOOOOOO....',
  '................',
];

const WHITEBOARD_COLORS: ColorMap = {
  O: 'ink',
  m: 'metal',
  M: 'metalLight',
  W: 'white',
  B: 'blue',
  R: 'red',
};

// ---------------------------------------------------------------------------

const tall = (grid: PixelGrid, colors: ColorMap): PropArt => ({ grid, colors, w: 16, h: 24 });
const square = (grid: PixelGrid, colors: ColorMap): PropArt => ({ grid, colors, w: 16, h: 16 });

export const PROP_ART: Readonly<Record<PropName, PropArt>> = {
  deskLeft: square(DESK_LEFT, DESK_COLORS),
  deskRight: square(DESK_RIGHT, DESK_COLORS),
  deskMonitor: square(merge(DESK_RIGHT, monitorOverlay('off')), DESK_MONITOR_COLORS),
  deskMonitorOn1: square(merge(DESK_RIGHT, monitorOverlay('on1')), DESK_MONITOR_COLORS),
  deskMonitorOn2: square(merge(DESK_RIGHT, monitorOverlay('on2')), DESK_MONITOR_COLORS),
  chairDown: square(CHAIR_DOWN, CHAIR_COLORS),
  chairUp: square(CHAIR_UP, CHAIR_COLORS),
  chairLeft: square(CHAIR_LEFT, CHAIR_COLORS),
  chairRight: square(CHAIR_RIGHT, CHAIR_COLORS),
  confTL: square(CONF_TL, CONF_COLORS),
  confT: square(CONF_T, CONF_COLORS),
  confTR: square(CONF_TR, CONF_COLORS),
  confBL: square(CONF_BL, CONF_COLORS),
  confB: square(CONF_B, CONF_COLORS),
  confBR: square(CONF_BR, CONF_COLORS),
  plantBig: tall(PLANT_BIG, PLANT_COLORS),
  plantSmall: square(PLANT_SMALL, PLANT_COLORS),
  coffeeMachine1: tall(coffeeMachine('R'), COFFEE_COLORS),
  coffeeMachine2: tall(coffeeMachine('d'), COFFEE_COLORS),
  waterCooler1: tall(waterCooler(5), WATER_COLORS),
  waterCooler2: tall(waterCooler(4), WATER_COLORS),
  bookshelf: tall(BOOKSHELF, BOOKSHELF_COLORS),
  printer: square(PRINTER, PRINTER_COLORS),
  whiteboard: square(WHITEBOARD, WHITEBOARD_COLORS),
};
