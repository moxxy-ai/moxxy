import { describe, expect, it } from 'vitest';
import { clickSchema, imagePointToScreen, rectangleSchema, responseSchema, screenshotSchema } from './contracts.js';
import { JsonLineDecoder } from './protocol.js';

describe('Windows computer control contracts', () => {
  const geometry = { x: -1920, y: -200, width: 1920, height: 1080 };
  it('maps image pixels into physical screen coordinates, including negative origins', () => {
    expect(imagePointToScreen({ x: 640, y: 360 }, { width: 1280, height: 720 }, geometry))
      .toEqual({ x: -960, y: 340 });
    expect(imagePointToScreen({ x: 0, y: 0 }, { width: 1280, height: 720 }, geometry))
      .toEqual({ x: -1920, y: -200 });
  });
  it('rejects image bounds, non-finite geometry and zero-sized captures', () => {
    expect(() => imagePointToScreen({ x: 1280, y: 0 }, { width: 1280, height: 720 }, geometry)).toThrow();
    expect(rectangleSchema.safeParse({ ...geometry, width: 0 }).success).toBe(false);
    expect(rectangleSchema.safeParse({ ...geometry, x: Infinity }).success).toBe(false);
  });
  it('accepts a window-local crop, never a negative or empty crop', () => {
    expect(screenshotSchema.safeParse({ windowId: 'w', region: { x: 10, y: 20, width: 200, height: 100 } }).success).toBe(true);
    expect(screenshotSchema.safeParse({ windowId: 'w', region: { x: -1, y: 20, width: 200, height: 100 } }).success).toBe(false);
  });
  it('requires exactly one fresh target reference for a click', () => {
    expect(clickSchema.safeParse({ windowId: 'w1', captureId: 'c1', x: 10, y: 20 }).success).toBe(true);
    expect(clickSchema.safeParse({ windowId: 'w1', observationId: 'o1', elementId: 'e1', button: 'right' }).success).toBe(true);
    for (const input of [
      { x: 10, y: 20 }, { windowId: 'w1', x: 10, y: 20 },
      { windowId: 'w1', captureId: 'c1', x: 10, y: 20, elementId: 'e1', observationId: 'o1' },
      { windowId: 'w1', observationId: 'o1', elementId: 'e1', count: 4 },
    ]) expect(clickSchema.safeParse(input).success).toBe(false);
  });
  it('rejects protocol mismatches and malformed envelopes', () => {
    expect(responseSchema.safeParse({ version: 1, id: '1', ok: true, result: {} }).success).toBe(false);
    expect(responseSchema.safeParse({ version: 2, id: '1', ok: false }).success).toBe(false);
  });
});

describe('bounded JSON lines', () => {
  it('decodes split UTF-8 and multiple frames without losing bytes', () => {
    const decoder = new JsonLineDecoder(128);
    const bytes = Buffer.from('{"text":"żółć"}\n{}\n');
    const result: unknown[] = [];
    for (const byte of bytes) result.push(...decoder.push(Buffer.from([byte])));
    expect(result).toEqual([{ text: 'żółć' }, {}]);
  });
  it('rejects oversize, malformed and incomplete messages', () => {
    expect(() => new JsonLineDecoder(3).push(Buffer.from('1234'))).toThrow(/limit/);
    expect(() => new JsonLineDecoder(100).push(Buffer.from('{bad}\n'))).toThrow();
    const decoder = new JsonLineDecoder(100);
    decoder.push(Buffer.from('{'));
    expect(() => decoder.finish()).toThrow(/incomplete/);
  });
});
