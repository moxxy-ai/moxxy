/**
 * The office's single master palette. EVERY sprite, tile, and icon draws only
 * from these colors — that constraint is what keeps the art consistent. Warm,
 * slightly desaturated ramps with hue-shifted shadows (shadows lean purple,
 * highlights lean yellow), one shared outline ink. Light source: top-left.
 */

export const PALETTE = {
  // outline / ink (never pure black — dark plum reads softer)
  ink: '#1f1833',
  inkSoft: '#352a4d',

  // wood floor ramp
  floorLight: '#d9a873',
  floor: '#c8945f',
  floorShade: '#b5814e',
  floorLine: '#8f6238',

  // carpet ramp (war room / lounge)
  carpetLight: '#5e84a8',
  carpet: '#46688c',
  carpetShade: '#365478',
  rug: '#b8553f',
  rugLight: '#d2705a',

  // walls
  wallTop: '#6e5c66',
  wallFace: '#ead9b8',
  wallFaceShade: '#d4bf96',
  wallBase: '#a08a6e',
  glass: '#aadbe8',
  glassLight: '#d8f2f8',

  // furniture wood + metal
  wood: '#935f3a',
  woodLight: '#b07a4c',
  woodDark: '#6b4226',
  metal: '#5a6275',
  metalLight: '#8a93a8',
  metalDark: '#3c4252',

  // screens & devices
  screen: '#22304a',
  screenGlow: '#7ee8a2',
  screenBlue: '#6ec3f0',
  led: '#ff6b5e',

  // plants
  leaf: '#4f9658',
  leafLight: '#74c27c',
  leafDark: '#32663e',
  pot: '#a3502e',
  potLight: '#c46a40',

  // people — skin ramp
  skinA: '#f2c898',
  skinAShade: '#d9a878',
  skinB: '#c98a58',
  skinBShade: '#a86e42',
  skinC: '#8a5a38',
  skinCShade: '#6e4428',

  // people — clothing accents
  red: '#d65a4a',
  redDark: '#a83e34',
  orange: '#e8973c',
  orangeDark: '#bf7026',
  yellow: '#e8c84a',
  yellowDark: '#bf9c30',
  green: '#5cab68',
  greenDark: '#3d7d48',
  teal: '#4ab8b0',
  tealDark: '#318a84',
  blue: '#5083d6',
  blueDark: '#365ea8',
  purple: '#8a64d6',
  purpleDark: '#6244a3',
  pink: '#d670a8',
  pinkDark: '#a84e80',

  // hair
  hairBlack: '#2c2438',
  hairBrown: '#6b4226',
  hairBlond: '#d9b35c',
  hairRed: '#b05030',
  hairGray: '#9a93a8',

  // neutrals
  white: '#f4efe2',
  paper: '#e2dccb',
  gray: '#a8a194',
  grayDark: '#6e6a60',
  shadow: '#00000055',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** One office worker's look: ramps picked from the master palette. */
export interface AgentLook {
  readonly skin: PaletteKey;
  readonly skinShade: PaletteKey;
  readonly hair: PaletteKey;
  readonly shirt: PaletteKey;
  readonly shirtShade: PaletteKey;
  readonly pants: PaletteKey;
  /** 0..n-1 — which authored hair style variant to use. */
  readonly hairStyle: number;
}

/** Twelve distinct looks; an agent gets `LOOKS[hash(sessionId) % 12]`. */
export const LOOKS: ReadonlyArray<AgentLook> = [
  { skin: 'skinA', skinShade: 'skinAShade', hair: 'hairBrown', shirt: 'blue', shirtShade: 'blueDark', pants: 'metalDark', hairStyle: 0 },
  { skin: 'skinB', skinShade: 'skinBShade', hair: 'hairBlack', shirt: 'red', shirtShade: 'redDark', pants: 'inkSoft', hairStyle: 1 },
  { skin: 'skinC', skinShade: 'skinCShade', hair: 'hairBlack', shirt: 'yellow', shirtShade: 'yellowDark', pants: 'blueDark', hairStyle: 2 },
  { skin: 'skinA', skinShade: 'skinAShade', hair: 'hairBlond', shirt: 'green', shirtShade: 'greenDark', pants: 'woodDark', hairStyle: 3 },
  { skin: 'skinB', skinShade: 'skinBShade', hair: 'hairBrown', shirt: 'purple', shirtShade: 'purpleDark', pants: 'metalDark', hairStyle: 0 },
  { skin: 'skinA', skinShade: 'skinAShade', hair: 'hairRed', shirt: 'teal', shirtShade: 'tealDark', pants: 'inkSoft', hairStyle: 1 },
  { skin: 'skinC', skinShade: 'skinCShade', hair: 'hairGray', shirt: 'orange', shirtShade: 'orangeDark', pants: 'blueDark', hairStyle: 2 },
  { skin: 'skinB', skinShade: 'skinBShade', hair: 'hairBlack', shirt: 'pink', shirtShade: 'pinkDark', pants: 'metalDark', hairStyle: 3 },
  { skin: 'skinA', skinShade: 'skinAShade', hair: 'hairBlack', shirt: 'white', shirtShade: 'gray', pants: 'woodDark', hairStyle: 0 },
  { skin: 'skinC', skinShade: 'skinCShade', hair: 'hairBrown', shirt: 'blue', shirtShade: 'blueDark', pants: 'inkSoft', hairStyle: 1 },
  { skin: 'skinB', skinShade: 'skinBShade', hair: 'hairBlond', shirt: 'redDark', shirtShade: 'ink', pants: 'metalDark', hairStyle: 2 },
  { skin: 'skinA', skinShade: 'skinAShade', hair: 'hairGray', shirt: 'greenDark', shirtShade: 'ink', pants: 'blueDark', hairStyle: 3 },
];

/** Deterministic look index for a session id. */
export function lookIndexFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % LOOKS.length;
}
