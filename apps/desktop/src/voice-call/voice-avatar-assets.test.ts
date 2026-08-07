import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FRAMES = Object.freeze([
  { name: 'blink', fileName: 'brick-girl-blink.png' },
  { name: 'idle', fileName: 'brick-girl-idle.png' },
  { name: 'medium', fileName: 'brick-girl-mouth-medium.png' },
  { name: 'round', fileName: 'brick-girl-mouth-o.png' },
  { name: 'wide', fileName: 'brick-girl-mouth-wide.png' },
] as const);

describe('Focus Mode avatar assets', () => {
  it.each(FRAMES)('ships a memory-bounded $name frame for Focus Mode', ({ fileName }) => {
    const filePath = resolve(process.cwd(), 'src/voice-call/assets/brick-girl/focus', fileName);
    const bytes = readFileSync(filePath);

    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(320);
    expect(bytes.readUInt32BE(20)).toBe(400);
    expect([4, 6]).toContain(bytes.readUInt8(25));
  });
});
