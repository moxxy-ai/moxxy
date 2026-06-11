import { describe, expect, it } from 'vitest';

import { BUBBLE_GRID, BUBBLE_TAIL, bubbleColors } from './bubble.js';
import { BODY_FRAMES, CHAR_H, CHAR_W, charColors, HAIR_STYLES } from './characters.js';
import { ICON_ART, POOF_FRAMES } from './icons.js';
import { LOOKS } from './palette.js';
import { isTransparent, validateGrid } from './pixel.js';
import { PROP_ART } from './props.js';
import { TILE_ART } from './tiles.js';

const LOOK = LOOKS[0]!;

describe('tiles', () => {
  it('every tile is 16×16 and fully color-mapped', () => {
    for (const [name, art] of Object.entries(TILE_ART)) {
      expect(validateGrid(name, art.grid, art.colors, { w: 16, h: 16 })).toEqual([]);
    }
  });
});

describe('props', () => {
  it('every prop matches its declared 16×h size and is fully color-mapped', () => {
    for (const [name, art] of Object.entries(PROP_ART)) {
      expect(validateGrid(name, art.grid, art.colors, { w: art.w, h: art.h })).toEqual([]);
    }
  });

  it('deskLeft and deskRight join seamlessly at the seam (rows 4-12)', () => {
    const left = PROP_ART.deskLeft.grid;
    const right = PROP_ART.deskRight.grid;
    for (let y = 4; y <= 12; y++) {
      expect(isTransparent(left[y]![15]!), `deskLeft row ${y} col 15`).toBe(false);
      expect(isTransparent(right[y]![0]!), `deskRight row ${y} col 0`).toBe(false);
    }
  });

  it('monitor-on frames differ from deskMonitor only inside the screen (rows 2-9)', () => {
    const base = PROP_ART.deskMonitor.grid;
    for (const name of ['deskMonitorOn1', 'deskMonitorOn2'] as const) {
      const on = PROP_ART[name].grid;
      const diffRows: number[] = [];
      for (let y = 0; y < base.length; y++) {
        for (let x = 0; x < 16; x++) {
          if (base[y]![x] !== on[y]![x]) diffRows.push(y);
        }
      }
      expect(diffRows.length, `${name} must glow`).toBeGreaterThan(0);
      for (const y of diffRows) {
        expect(y, `${name} diff outside screen`).toBeGreaterThanOrEqual(2);
        expect(y, `${name} diff outside screen`).toBeLessThanOrEqual(9);
      }
    }
  });

  it('the two frames of each animated prop differ', () => {
    expect(PROP_ART.coffeeMachine1.grid).not.toEqual(PROP_ART.coffeeMachine2.grid);
    expect(PROP_ART.waterCooler1.grid).not.toEqual(PROP_ART.waterCooler2.grid);
    expect(PROP_ART.deskMonitorOn1.grid).not.toEqual(PROP_ART.deskMonitorOn2.grid);
  });
});

describe('characters', () => {
  const colors = charColors(LOOK);

  it('every body frame is 16×24 and fully color-mapped', () => {
    for (const [name, grid] of Object.entries(BODY_FRAMES)) {
      expect(validateGrid(name, grid, colors, { w: CHAR_W, h: CHAR_H })).toEqual([]);
    }
  });

  it('every hair style is 16×10 and fully color-mapped, 4 styles per facing', () => {
    for (const [facing, styles] of Object.entries(HAIR_STYLES)) {
      expect(styles.length, `${facing} style count`).toBe(4);
      styles.forEach((grid, i) => {
        expect(validateGrid(`hair-${facing}-${i}`, grid, colors, { w: 16, h: 10 })).toEqual([]);
      });
    }
  });

  it('charColors maps the full character charset for every look', () => {
    for (const look of LOOKS) {
      const map = charColors(look);
      for (const ch of ['O', 'S', 's', 'H', 'T', 't', 'P', 'K', 'W', 'E']) {
        expect(map[ch], `char '${ch}'`).toBeDefined();
      }
    }
  });

  it('walk frames differ from their idle frame', () => {
    const cycles = [
      { idle: 'idleDown', walks: ['walkDown1', 'walkDown2', 'walkDown3', 'walkDown4'] },
      { idle: 'idleUp', walks: ['walkUp1', 'walkUp2', 'walkUp3', 'walkUp4'] },
      { idle: 'idleRight', walks: ['walkRight1', 'walkRight2', 'walkRight3', 'walkRight4'] },
    ] as const;
    for (const { idle, walks } of cycles) {
      for (const walk of walks) {
        expect(BODY_FRAMES[walk], `${walk} vs ${idle}`).not.toEqual(BODY_FRAMES[idle]);
      }
    }
  });

  it('heads stay fixed across each facing cycle so hair overlays align', () => {
    const headRows = (name: keyof typeof BODY_FRAMES) => BODY_FRAMES[name].slice(0, 9);
    for (const f of ['walkDown1', 'walkDown2', 'walkDown3', 'walkDown4', 'idleDown2'] as const) {
      expect(headRows(f), `${f} head`).toEqual(headRows('idleDown'));
    }
    for (const f of ['walkUp1', 'walkUp2', 'walkUp3', 'walkUp4', 'sitUp', 'typeUp1', 'typeUp2'] as const) {
      expect(headRows(f), `${f} head`).toEqual(headRows('idleUp'));
    }
    for (const f of ['walkRight1', 'walkRight2', 'walkRight3', 'walkRight4', 'sitRight'] as const) {
      expect(headRows(f), `${f} head`).toEqual(headRows('idleRight'));
    }
  });
});

describe('icons', () => {
  it('every icon is 8×8 and fully color-mapped', () => {
    for (const [name, art] of Object.entries(ICON_ART)) {
      expect(validateGrid(name, art.grid, art.colors, { w: 8, h: 8 })).toEqual([]);
    }
  });

  it('poof has 3 distinct 16×16 frames', () => {
    expect(POOF_FRAMES.length).toBe(3);
    POOF_FRAMES.forEach((art, i) => {
      expect(validateGrid(`poof-${i}`, art.grid, art.colors, { w: 16, h: 16 })).toEqual([]);
    });
    expect(POOF_FRAMES[0]!.grid).not.toEqual(POOF_FRAMES[1]!.grid);
    expect(POOF_FRAMES[1]!.grid).not.toEqual(POOF_FRAMES[2]!.grid);
  });
});

describe('bubble', () => {
  const tones = ['speech', 'thought', 'tool', 'alert', 'error'] as const;

  it('bubble grids have their declared sizes and every tone maps the charset', () => {
    for (const tone of tones) {
      const colors = bubbleColors(tone);
      expect(validateGrid(`bubble-${tone}`, BUBBLE_GRID, colors, { w: 18, h: 14 })).toEqual([]);
      expect(validateGrid(`tail-${tone}`, BUBBLE_TAIL, colors, { w: 7, h: 5 })).toEqual([]);
    }
  });

  it('the 9-slice interior (inside the 6px margins) is uniform fill', () => {
    const w = 18;
    const h = 14;
    for (let y = 6; y < h - 6; y++) {
      for (let x = 6; x < w - 6; x++) {
        expect(BUBBLE_GRID[y]![x], `(${x},${y})`).toBe('F');
      }
    }
  });
});
