import { describe, expect, it } from 'vitest';
import { Mover } from './mover.js';

describe('Mover', () => {
  it('rests at the feet anchor of its start tile', () => {
    const m = new Mover({ x: 2, y: 3 });
    expect(m.state).toMatchObject({ x: 2 * 16 + 8, y: 3 * 16 + 16, moving: false });
    expect(m.tile).toEqual({ x: 2, y: 3 });
  });

  it('moves one tile per 250ms at the default 4 tiles/s', () => {
    const m = new Mover({ x: 0, y: 0 });
    m.setPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    m.update(250);
    expect(m.state.x).toBe(24); // tile (1,0) feet anchor
    expect(m.state.y).toBe(16);
    expect(m.state.moving).toBe(true);
    m.update(250);
    expect(m.state.x).toBe(40);
    expect(m.state.moving).toBe(false);
    expect(m.tile).toEqual({ x: 2, y: 0 });
  });

  it('faces along the current segment and keeps facing after arrival', () => {
    const m = new Mover({ x: 0, y: 0 });
    m.setPath([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    m.update(125);
    expect(m.state.facing).toBe('down');
    m.update(250);
    expect(m.state.facing).toBe('right'); // crossed into the second segment
    m.update(250);
    expect(m.state.moving).toBe(false);
    expect(m.state.facing).toBe('right'); // preserved after arrival
  });

  it('fires onArrive exactly once, on the update that reaches the final tile', () => {
    const m = new Mover({ x: 0, y: 0 });
    let arrivals = 0;
    m.setPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      () => arrivals++,
    );
    m.update(249);
    expect(arrivals).toBe(0);
    m.update(1);
    expect(arrivals).toBe(1);
    m.update(500);
    expect(arrivals).toBe(1);
  });

  it('crosses several tiles in one big-dt update', () => {
    const m = new Mover({ x: 0, y: 0 });
    let arrived = false;
    m.setPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
      ],
      () => {
        arrived = true;
      },
    );
    m.update(10_000);
    expect(arrived).toBe(true);
    expect(m.tile).toEqual({ x: 3, y: 1 });
    expect(m.state.moving).toBe(false);
    expect(m.state.facing).toBe('down'); // last segment
  });

  it('lands mid-segment for partial dt', () => {
    const m = new Mover({ x: 0, y: 0 });
    m.setPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    m.update(125); // half a tile = 8px
    expect(m.state.x).toBe(16);
    expect(m.state.y).toBe(16);
  });

  it('stop() halts at the current pixel position and cancels onArrive', () => {
    const m = new Mover({ x: 0, y: 0 });
    let arrivals = 0;
    m.setPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      () => arrivals++,
    );
    m.update(125);
    m.stop();
    const { x, y } = m.state;
    m.update(1000);
    expect(m.state.x).toBe(x);
    expect(m.state.y).toBe(y);
    expect(m.state.moving).toBe(false);
    expect(arrivals).toBe(0);
  });

  it('setPath replaces the current path and its onArrive', () => {
    const m = new Mover({ x: 0, y: 0 });
    let first = 0;
    let second = 0;
    m.setPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      () => first++,
    );
    m.setPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
      () => second++,
    );
    m.update(1000);
    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(m.tile).toEqual({ x: 0, y: 1 });
  });

  it('arrives immediately on a single-tile path at the current tile', () => {
    const m = new Mover({ x: 2, y: 2 });
    let arrivals = 0;
    m.setPath([{ x: 2, y: 2 }], () => arrivals++);
    m.update(16);
    expect(arrivals).toBe(1);
    expect(m.state.moving).toBe(false);
  });

  it('teleport() snaps to the tile and clears any path', () => {
    const m = new Mover({ x: 0, y: 0 });
    m.setPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    m.teleport({ x: 5, y: 5 });
    m.update(500);
    expect(m.tile).toEqual({ x: 5, y: 5 });
    expect(m.state.moving).toBe(false);
  });
});
