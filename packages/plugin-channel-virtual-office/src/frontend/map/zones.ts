/**
 * Hand-authored points of interest on {@link OFFICE_MAP}. Coordinates are
 * tile-space (x right, y down) and are pinned to the ASCII art by the map
 * test suite — move a desk in the art, and the test tells you to move the
 * zone too.
 */

import type { Zones } from '../sim/types.js';

export const ZONES: Zones = {
  // Six private offices along the north wall, west → east. Each seat is the
  // chair directly south of the desk's monitor half (']'), facing it.
  offices: [
    { index: 0, door: { x: 4, y: 7 }, seat: { tile: { x: 3, y: 3 }, facing: 'up' }, monitorTile: { x: 3, y: 2 } },
    { index: 1, door: { x: 10, y: 7 }, seat: { tile: { x: 11, y: 3 }, facing: 'up' }, monitorTile: { x: 11, y: 2 } },
    { index: 2, door: { x: 17, y: 7 }, seat: { tile: { x: 17, y: 3 }, facing: 'up' }, monitorTile: { x: 17, y: 2 } },
    { index: 3, door: { x: 24, y: 7 }, seat: { tile: { x: 25, y: 3 }, facing: 'up' }, monitorTile: { x: 25, y: 2 } },
    { index: 4, door: { x: 31, y: 7 }, seat: { tile: { x: 31, y: 3 }, facing: 'up' }, monitorTile: { x: 31, y: 2 } },
    { index: 5, door: { x: 39, y: 7 }, seat: { tile: { x: 39, y: 3 }, facing: 'up' }, monitorTile: { x: 39, y: 2 } },
  ],

  // War room: glass door at (12,15); eight seats around the 4×2 conference
  // table at x4..7 × y14..15 — three above, three below, one on each end.
  warRoom: {
    door: { x: 12, y: 15 },
    seats: [
      { tile: { x: 4, y: 13 }, facing: 'down' },
      { tile: { x: 5, y: 13 }, facing: 'down' },
      { tile: { x: 6, y: 13 }, facing: 'down' },
      { tile: { x: 5, y: 16 }, facing: 'up' },
      { tile: { x: 6, y: 16 }, facing: 'up' },
      { tile: { x: 7, y: 16 }, facing: 'up' },
      { tile: { x: 3, y: 14 }, facing: 'right' },
      { tile: { x: 8, y: 15 }, facing: 'left' },
    ],
  },

  // Open-space hot desks (two pairs, rows 12 and 16).
  hotDesks: [
    { tile: { x: 18, y: 13 }, facing: 'up' },
    { tile: { x: 25, y: 13 }, facing: 'up' },
    { tile: { x: 18, y: 17 }, facing: 'up' },
    { tile: { x: 25, y: 17 }, facing: 'up' },
  ],

  // Stand-here tiles facing the appliances on the east wall.
  coffee: { tile: { x: 41, y: 12 }, facing: 'right' },
  cooler: { tile: { x: 41, y: 14 }, facing: 'right' },

  // On the entrance mat, just inside the double south doors.
  entrance: { x: 21, y: 28 },

  // Idle wander targets, spread across corridor, open space and lounge.
  wanderTiles: [
    { x: 6, y: 9 }, // corridor west
    { x: 20, y: 9 }, // corridor center
    { x: 36, y: 8 }, // corridor east
    { x: 14, y: 13 }, // open space, by the glass wall
    { x: 21, y: 14 }, // open space, between hot desk pairs
    { x: 28, y: 15 }, // open space center
    { x: 33, y: 18 }, // south of the rug
    { x: 38, y: 21 }, // walkway east
    { x: 8, y: 22 }, // walkway west (war-room front)
    { x: 16, y: 23 }, // walkway center
    { x: 30, y: 23 }, // walkway east-center
    { x: 5, y: 26 }, // lounge west
    { x: 21, y: 25 }, // lounge rug
    { x: 35, y: 26 }, // lounge east
    { x: 10, y: 27 }, // lounge southwest
    { x: 40, y: 24 }, // lounge northeast corner
  ],
};
