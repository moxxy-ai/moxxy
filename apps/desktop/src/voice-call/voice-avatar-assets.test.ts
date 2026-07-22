import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FRAMES = Object.freeze([
  { name: 'blink', fileName: 'brick-girl-blink.png', expectedHash: '59c078042fa5eda7f2404f4e3cc3ed57aaaedaf49c617358bbd894a3c26a10d0' },
  { name: 'idle', fileName: 'brick-girl-idle.png', expectedHash: '71fb6a4fd151403284152614c356cff9a253c6b397b803e0b409cbf211092e36' },
  { name: 'medium', fileName: 'brick-girl-mouth-medium.png', expectedHash: '7badc566da88336e8f2b003e89f8159d0363cd272dbae1837aafa93ad89fd046' },
  { name: 'round', fileName: 'brick-girl-mouth-o.png', expectedHash: 'ffc1e9d106c397f71d650f1c7c3dc81c9b68f373863df4f0ba45eb15e77c4f41' },
  { name: 'wide', fileName: 'brick-girl-mouth-wide.png', expectedHash: '23b02a22aaee4546e3598fefa001e2505bcf069dd2e2eded886de4f076429e38' },
] as const);

describe('Moxxy voice avatar assets', () => {
  it.each(FRAMES)('keeps the $name frame aligned and unmodified', ({ fileName, expectedHash }) => {
    const filePath = resolve(process.cwd(), 'src/voice-call/assets/brick-girl', fileName);
    const bytes = readFileSync(filePath);

    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(1122);
    expect(bytes.readUInt32BE(20)).toBe(1402);
    expect([4, 6]).toContain(bytes.readUInt8(25));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash);
  });
});
