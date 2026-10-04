import { describe, expect, it } from 'vitest';
import { changedAround, decodePng } from './view.js';
import { canvas, encodePng } from './png.test-support.js';

describe('decodePng', () => {
  it('reads back what was encoded, through every row filter', () => {
    const picture = canvas(9, 7, [10, 20, 30, 255]);
    picture.paint(2, 1, 4, 3, [200, 100, 50, 255]);
    picture.paint(5, 4, 3, 2, [1, 250, 3, 128]);

    const pixels = decodePng(encodePng(picture, { filters: [0, 1, 2, 3, 4] }));

    expect(pixels).toMatchObject({ width: 9, height: 7, channels: 4 });
    expect(Buffer.compare(pixels?.data ?? Buffer.alloc(0), picture.data)).toBe(0);
  });

  it('reads an RGB picture without alpha', () => {
    const picture = canvas(4, 3, [5, 6, 7, 255]);
    const pixels = decodePng(encodePng(picture, { rgb: true, filters: [4, 1] }));

    expect(pixels).toMatchObject({ width: 4, height: 3, channels: 3 });
    expect([...(pixels?.data.subarray(0, 3) ?? [])]).toEqual([5, 6, 7]);
  });

  it('gives up on what it cannot read rather than guessing', () => {
    expect(decodePng(Buffer.from('not a png'))).toBeNull();
  });
});

describe('changedAround', () => {
  const before = canvas(100, 60);
  before.paint(10, 10, 20, 20, [0, 0, 255, 255]);
  const read = (p: ReturnType<typeof canvas>) => {
    const pixels = decodePng(encodePng(p));
    if (!pixels) throw new Error('unreadable');
    return pixels;
  };

  it('sees nothing changed when the place looks the same', () => {
    expect(changedAround(read(before), read(before), { x: 20, y: 20 }, 12)).toBe(false);
  });

  it('sees a change at the target', () => {
    const after = canvas(100, 60);
    after.paint(10, 10, 20, 20, [255, 0, 0, 255]);

    expect(changedAround(read(before), read(after), { x: 20, y: 20 }, 12)).toBe(true);
  });

  it('ignores a change far from the target', () => {
    const after = canvas(100, 60);
    after.paint(10, 10, 20, 20, [0, 0, 255, 255]);
    after.paint(80, 40, 10, 10, [0, 0, 0, 255]);

    expect(changedAround(read(before), read(after), { x: 20, y: 20 }, 12)).toBe(false);
  });

  it('treats a picture of another size as changed', () => {
    expect(changedAround(read(before), read(canvas(50, 60)), { x: 20, y: 20 }, 12)).toBe(true);
  });
});
