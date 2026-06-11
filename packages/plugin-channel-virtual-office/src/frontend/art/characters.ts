/**
 * Worker sprites: 16×24, head fixed during every cycle (only legs/arms move)
 * so the 16×10 hair overlays stay aligned at y=0. Frames are composed from
 * shared head / torso / leg segments — the head rows of every down-facing
 * frame are literally the same array, which is what keeps hair registration
 * exact. Left-facing is a runtime flipX of right; only right is authored.
 *
 * Charset (see charColors): O outline, S/s skin+shade, H hair, T/t shirt+
 * shade, P pants, K shoes, W/E eye white+pupil.
 */

import type { AgentLook } from './palette.js';
import type { ColorMap, PixelGrid } from './pixel.js';

export const CHAR_W = 16;
export const CHAR_H = 24;

export type BodyFrameName =
  | 'idleDown'
  | 'idleDown2'
  | 'blinkDown'
  | 'idleUp'
  | 'idleRight'
  | 'walkDown1'
  | 'walkDown2'
  | 'walkDown3'
  | 'walkDown4'
  | 'walkUp1'
  | 'walkUp2'
  | 'walkUp3'
  | 'walkUp4'
  | 'walkRight1'
  | 'walkRight2'
  | 'walkRight3'
  | 'walkRight4'
  | 'sitUp'
  | 'typeUp1'
  | 'typeUp2'
  | 'sitDown'
  | 'sitRight';

export function charColors(look: AgentLook): ColorMap {
  return {
    O: 'ink',
    S: look.skin,
    s: look.skinShade,
    H: look.hair,
    T: look.shirt,
    t: look.shirtShade,
    P: look.pants,
    K: 'metalDark',
    W: 'white',
    E: 'ink',
  };
}

// --- heads (rows 0-8), hairless: skin-colored scalp ------------------------

const HEAD_DOWN: readonly string[] = [
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSWESSWESO...',
  '...OSSSSSSSSO...',
  '....OSSSSSSO....',
  '.....OssssO.....',
  '......OssO......',
];

const HEAD_DOWN_BLINK: readonly string[] = [
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSssSSssSO...',
  '...OSSSSSSSSO...',
  '....OSSSSSSO....',
  '.....OssssO.....',
  '......OssO......',
];

const HEAD_UP: readonly string[] = [
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '....OSSSSSSO....',
  '.....OssssO.....',
  '......OssO......',
];

const HEAD_RIGHT: readonly string[] = [
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OsSSSSWESO...',
  '...OsSSSSSSSO...',
  '....OsSSSSSO....',
  '.....OssssO.....',
  '......OssO......',
];

// --- torsos (rows 9-15) -----------------------------------------------------

/** Down/up neutral: hands resting at both sides (rows 13-14). */
const TORSO_NEUTRAL: readonly string[] = [
  '....OTTTTTtO....',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OSTTTTTtSO...',
  '...OSTTTTTtSO...',
  '....OTTTTTtO....',
];

/** Arm swing A: left hand up (rows 12-13), right hand down (rows 14-15). */
const TORSO_SWING_A: readonly string[] = [
  '....OTTTTTtO....',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OSTTTTTttO...',
  '...OSTTTTTttO...',
  '...OTTTTTTtSO...',
  '....OTTTTtSO....',
];

/** Arm swing B: mirror of A. */
const TORSO_SWING_B: readonly string[] = [
  '....OTTTTTtO....',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OTTTTTTtSO...',
  '...OTTTTTTtSO...',
  '...OSTTTTTTtO...',
  '....OSTTTTtO....',
];

/** Right-facing neutral: near arm along the side (x6-7), hand row 13. */
const TORSO_RIGHT: readonly string[] = [
  '....OTTTTTtO....',
  '...OTTttTTTtO...',
  '...OTTttTTTtO...',
  '...OTTttTTTtO...',
  '...OTTSSTTTtO...',
  '...OTTTTTTTtO...',
  '....OTTTTTtO....',
];

/** Right-facing, arm swung forward (x8-9). */
const TORSO_RIGHT_FWD: readonly string[] = [
  '....OTTTTTtO....',
  '...OTTTTttTtO...',
  '...OTTTTttTtO...',
  '...OTTTTttTtO...',
  '...OTTTTSSTtO...',
  '...OTTTTTTTtO...',
  '....OTTTTTtO....',
];

/** Right-facing, arm swung back (x4-5). */
const TORSO_RIGHT_BACK: readonly string[] = [
  '....OTTTTTtO....',
  '...OttTTTTTtO...',
  '...OttTTTTTtO...',
  '...OttTTTTTtO...',
  '...OSSTTTTTtO...',
  '...OTTTTTTTtO...',
  '....OTTTTTtO....',
];

// --- legs (rows 16-23) ------------------------------------------------------

/** Both feet planted. */
const LEGS_STAND: readonly string[] = [
  '....OPPPPPPO....',
  '....OPPPPPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OKKOOKKO....',
  '....OOO..OOO....',
];

/** Contact, left leg planted, right foot lifted one row. */
const LEGS_LEFT_FWD: readonly string[] = [
  '....OPPPPPPO....',
  '....OPPPPPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OPPOOKKO....',
  '....OKKOOOOO....',
  '....OOO.........',
];

/** Contact, right leg planted, left foot lifted one row. */
const LEGS_RIGHT_FWD: readonly string[] = [
  '....OPPPPPPO....',
  '....OPPPPPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OKKOOPPO....',
  '....OOOOOKKO....',
  '.........OOO....',
];

/** Passing: legs together in a single mass. */
const LEGS_PASS: readonly string[] = [
  '....OPPPPPPO....',
  '....OPPPPPPO....',
  '.....OPPPPO.....',
  '.....OPPPPO.....',
  '.....OPPPPO.....',
  '.....OPPPPO.....',
  '.....OKKKKO.....',
  '.....OO..OO.....',
];

/** Profile stride: back leg trailing left, front leg reaching right. */
const LEGS_STRIDE: readonly string[] = [
  '....OPPPPPPO....',
  '...OPPPPPPPPO...',
  '...OPPO..OPPO...',
  '..OPPO....OPPO..',
  '..OPPO....OPPO..',
  '..OPPO....OPPO..',
  '..OKKO....OKKO..',
  '..OOOO....OOOO..',
];

/** Profile passing: legs gathered under the body. */
const LEGS_PASS_RIGHT: readonly string[] = [
  '....OPPPPPPO....',
  '....OPPPPPPO....',
  '.....OPPPPO.....',
  '.....OPPPPO.....',
  '.....OPPPPO.....',
  '.....OPPPPO.....',
  '.....OKKKKO.....',
  '.....OOOOOO.....',
];

// --- composed frames --------------------------------------------------------

const frame = (...parts: ReadonlyArray<readonly string[]>): PixelGrid => parts.flat();

const EMPTY_6: readonly string[] = Array.from({ length: 6 }, () => '................');

const IDLE_DOWN = frame(HEAD_DOWN, TORSO_NEUTRAL, LEGS_STAND);

/** Breathing: the torso block drops one row (head and legs stay put). */
const IDLE_DOWN_2 = frame(
  HEAD_DOWN,
  ['......OssO......'],
  TORSO_NEUTRAL,
  LEGS_STAND.slice(1),
);

const IDLE_UP = frame(HEAD_UP, TORSO_NEUTRAL, LEGS_STAND);
const IDLE_RIGHT = frame(HEAD_RIGHT, TORSO_RIGHT, LEGS_STAND);

const SIT_UP_BODY: readonly string[] = [
  '....OTTTTTtO....',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OtTTTTTttO...',
  '...OTTTTTTTtO...',
  '...OttttttttO...',
  '....OOOOOOOO....',
];

/** Typing torsos: rows 9-10 swap which hand is raised beside the desk. */
const typeBody = (hands: 'leftUp' | 'rightUp'): readonly string[] => [
  hands === 'leftUp' ? '..OSOTTTTTtO....' : '....OTTTTTtOSO..',
  hands === 'leftUp' ? '...OTTTTTTTtOSO.' : '.OSOTTTTTTTtO...',
  ...SIT_UP_BODY.slice(2),
];

const SIT_DOWN = frame(HEAD_DOWN, [
  '....OTTTTTtO....',
  '...OTTTTTTTtO...',
  '...OTTTTTTTtO...',
  '...OSTTTTTtSO...',
  '...OSTTTTTtSO...',
  '...OTTTTTTTtO...',
  '...OPPPPPPPPO...',
  '...OPPPPPPPPO...',
  '....OPPOOPPO....',
  '....OPPOOPPO....',
  '....OKKOOKKO....',
  '....OOO..OOO....',
  '................',
  '................',
  '................',
]);

const SIT_RIGHT = frame(HEAD_RIGHT, [
  '....OTTTTTtO....',
  '...OTTttTTTtO...',
  '...OTTttTTTtO...',
  '...OTTSSTTTtO...',
  '...OTTTTTTTtO...',
  '....OPPPPPPPPO..',
  '....OPPPPPPPPO..',
  '.........OPPO...',
  '.........OPPO...',
  '.........OKKKO..',
  '.........OOOOO..',
  '................',
  '................',
  '................',
  '................',
]);

const WALK_DOWN_1 = frame(HEAD_DOWN, TORSO_SWING_A, LEGS_LEFT_FWD);
const WALK_DOWN_2 = frame(HEAD_DOWN, TORSO_SWING_A, LEGS_PASS);
const WALK_DOWN_3 = frame(HEAD_DOWN, TORSO_SWING_B, LEGS_RIGHT_FWD);
const WALK_DOWN_4 = frame(HEAD_DOWN, TORSO_SWING_B, LEGS_PASS);

export const BODY_FRAMES: Readonly<Record<BodyFrameName, PixelGrid>> = {
  idleDown: IDLE_DOWN,
  idleDown2: IDLE_DOWN_2,
  blinkDown: frame(HEAD_DOWN_BLINK, TORSO_NEUTRAL, LEGS_STAND),
  idleUp: IDLE_UP,
  idleRight: IDLE_RIGHT,
  walkDown1: WALK_DOWN_1,
  walkDown2: WALK_DOWN_2,
  walkDown3: WALK_DOWN_3,
  walkDown4: WALK_DOWN_4,
  walkUp1: frame(HEAD_UP, TORSO_SWING_A, LEGS_LEFT_FWD),
  walkUp2: frame(HEAD_UP, TORSO_SWING_A, LEGS_PASS),
  walkUp3: frame(HEAD_UP, TORSO_SWING_B, LEGS_RIGHT_FWD),
  walkUp4: frame(HEAD_UP, TORSO_SWING_B, LEGS_PASS),
  walkRight1: frame(HEAD_RIGHT, TORSO_RIGHT_FWD, LEGS_STRIDE),
  walkRight2: frame(HEAD_RIGHT, TORSO_RIGHT_FWD, LEGS_PASS_RIGHT),
  walkRight3: frame(HEAD_RIGHT, TORSO_RIGHT_BACK, LEGS_STAND),
  walkRight4: frame(HEAD_RIGHT, TORSO_RIGHT_BACK, LEGS_PASS_RIGHT),
  sitUp: frame(HEAD_UP, SIT_UP_BODY, EMPTY_6),
  typeUp1: frame(HEAD_UP, typeBody('leftUp'), EMPTY_6),
  typeUp2: frame(HEAD_UP, typeBody('rightUp'), EMPTY_6),
  sitDown: SIT_DOWN,
  sitRight: SIT_RIGHT,
};

// --- hair overlays (16×10, drawn at y=0 over the fixed head) ----------------

const pad = (rows: readonly string[]): PixelGrid => [
  ...rows,
  ...Array.from({ length: 10 - rows.length }, () => '................'),
];

/** Styles: 0 short crop, 1 side-swept, 2 curly/afro, 3 ponytail. */
export const HAIR_STYLES: Readonly<Record<'down' | 'up' | 'right', ReadonlyArray<PixelGrid>>> = {
  down: [
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHHO...',
      '...OHH....HHO...',
    ]),
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHHO...',
      '...OHHHHH.HHO...',
      '...OH......HO...',
      '...OH......HO...',
    ]),
    pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHH......HHO..',
      '...OH......HO...',
    ]),
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHHO...',
      '...OHHH..HHHO...',
    ]),
  ],
  up: [
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '....OHHHHHHO....',
    ]),
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '....OHHHHHHO....',
      '.....OHHHHO.....',
    ]),
    pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '...OHHHHHHHHO...',
      '....OHHHHHHO....',
    ]),
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '...OHHHHHHHHO...',
      '....OHHHHHHO....',
      '......OHHO......',
      '......OHHO......',
      '.......OHO......',
    ]),
  ],
  right: [
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHH.....',
      '...OHH..........',
      '...OH...........',
    ]),
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHHH....',
      '...OHHH.........',
      '...OHH..........',
      '...OH...........',
    ]),
    pad([
      '....OOOOOOOO....',
      '...OHHHHHHHHO...',
      '..OHHHHHHHHHO...',
      '..OHHHHHH.......',
      '..OHHH..........',
      '...OH...........',
    ]),
    pad([
      '.....OOOOOO.....',
      '....OHHHHHHO....',
      '...OHHHHHHH.....',
      '..OHHH..........',
      '..OHH...........',
      '..OHH...........',
      '..OH............',
    ]),
  ],
};
