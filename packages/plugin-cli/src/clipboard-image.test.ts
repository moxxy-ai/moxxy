import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

const originalPlatform = process.platform;
const originalMoxxyHome = process.env.MOXXY_HOME;
const tempDirs: string[] = [];

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

async function loadModule() {
  // Fresh import each test so MOXXY_HOME / platform are read at call time.
  return import('./clipboard-image.js');
}

beforeEach(() => {
  spawnSyncMock.mockReset();
  const dir = mkdtempSync(path.join(tmpdir(), 'moxxy-clip-'));
  tempDirs.push(dir);
  process.env.MOXXY_HOME = dir;
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  if (originalMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = originalMoxxyHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('clipboard-image ESM safety (u77-1)', () => {
  it('never uses CommonJS require() — fatal in this "type":"module" package when bundled to ESM', () => {
    // vitest transforms modules with a CJS-compatible runtime, so a runtime
    // call to require() does NOT throw here even though it ReferenceErrors in
    // the real ESM bundle. Guard statically against reintroducing it.
    const src = readFileSync(fileURLToPath(new URL('./clipboard-image.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/\brequire\s*\(/);
  });
});

describe('readClipboardImageSync (Linux path)', () => {
  it('writes clipboard PNG bytes to a cache file and returns the path (no require ReferenceError)', async () => {
    setPlatform('linux');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: pngBytes,
      stderr: Buffer.alloc(0),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    const { readClipboardImageSync } = await loadModule();
    const detected = readClipboardImageSync();

    expect(detected).not.toBeNull();
    expect(detected?.mediaType).toBe('image/png');
    // The bytes must actually have been written via the ESM import — the
    // pre-fix `require('node:fs')` threw a ReferenceError that the catch
    // swallowed into a null return.
    expect(detected && readFileSync(detected.absPath)).toEqual(pngBytes);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'xclip',
      ['-selection', 'clipboard', '-t', 'image/png', '-o'],
      expect.objectContaining({ encoding: 'buffer' }),
    );
  });

  it('returns null when no clipboard tool yields image bytes', async () => {
    setPlatform('linux');
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      pid: 1,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);

    const { readClipboardImageSync } = await loadModule();
    expect(readClipboardImageSync()).toBeNull();
  });

  it('returns null on unsupported platforms without invoking any tool', async () => {
    setPlatform('win32');
    const { readClipboardImageSync } = await loadModule();
    expect(readClipboardImageSync()).toBeNull();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

describe('Darwin AppleScript path escaping (osascript interpolation safety)', () => {
  it('escapes backslashes and double-quotes so a hostile path cannot break out of the literal', async () => {
    const { escapeAppleScriptString } = await loadModule();
    // Escape order matters: backslash first, then quote.
    expect(escapeAppleScriptString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(escapeAppleScriptString('plain/path.png')).toBe('plain/path.png');
  });

  it('leaves exactly the two wrapping quotes unescaped per POSIX file line', async () => {
    const { buildDarwinClipboardScript } = await loadModule();
    // A path containing a `"` would, unescaped, close the AppleScript literal
    // early and let the trailing text run as code.
    const evil = '/home/a"; do shell script "rm -rf ~"//x.png';
    const script = buildDarwinClipboardScript(evil);
    const posixLines = script.filter((l) => l.includes('POSIX file "'));
    expect(posixLines.length).toBe(2);
    for (const line of posixLines) {
      // Count `"` not preceded by a backslash — a correctly-escaped path
      // leaves exactly the two literal delimiters.
      const unescaped = line.match(/(?<!\\)"/g) ?? [];
      expect(unescaped).toHaveLength(2);
    }
    // The injected substring survives only as escaped content, never as a bare
    // closing quote.
    expect(script.join('\n')).toContain('a\\";');
  });
});

describe('reapStale (u77-2: cache no longer grows unbounded)', () => {
  it('removes stale clip-*.png and keeps recent ones (by embedded timestamp)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'moxxy-clip-reap-'));
    tempDirs.push(dir);
    const now = 1_000_000_000_000;
    const old = now - 48 * 60 * 60 * 1000; // 48h ago
    const recent = now - 60 * 1000; // 1m ago
    writeFileSync(path.join(dir, `clip-${old}-aaaaaa.png`), 'x');
    writeFileSync(path.join(dir, `clip-${recent}-bbbbbb.png`), 'x');
    // Non-clip files (and unrelated names) are never touched.
    writeFileSync(path.join(dir, 'keep-me.txt'), 'x');

    const { reapStale } = await loadModule();
    reapStale(dir, now);

    const left = readdirSync(dir).sort();
    expect(left).toEqual([`clip-${recent}-bbbbbb.png`, 'keep-me.txt'].sort());
  });

  it('is a no-op on a missing directory (never throws during a paste)', async () => {
    const { reapStale } = await loadModule();
    expect(() => reapStale(path.join(tmpdir(), 'moxxy-clip-does-not-exist-xyz'))).not.toThrow();
  });
});
