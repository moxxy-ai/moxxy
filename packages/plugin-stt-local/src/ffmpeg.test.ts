import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { __resetFfmpegProbeForTest, decodeViaFfmpeg, missingFfmpegError } from './ffmpeg.js';

/** A fake `spawn` that plays the ffmpeg probe (`-version`) and the decode
 *  (`f32le` pipe) roles. Configurable per-role so tests drive deterministic
 *  outcomes without a real ffmpeg. */
interface FakeSpawnConfig {
  /** Probe: 'ok' → exit 0, 'fail' → exit 1, 'enoent' → emit spawn error. */
  readonly probe?: 'ok' | 'fail' | 'enoent';
  /** Decode stdout samples (encoded as f32le), or null to emit none. */
  readonly decodeSamples?: Float32Array | null;
  /** Decode exit code (default 0). */
  readonly decodeExit?: number;
  /** Decode stderr text. */
  readonly decodeStderr?: string;
}

function makeFakeSpawn(config: FakeSpawnConfig): {
  spawnImpl: typeof spawn;
  probeCalls: number;
  decodeCalls: number;
  fedStdin: Buffer[];
} {
  const stats = { probeCalls: 0, decodeCalls: 0, fedStdin: [] as Buffer[] };

  const spawnImpl = ((_cmd: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { writable: boolean; on: () => void; end: (b?: Buffer) => void };
      kill: () => boolean;
      killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    const isProbe = args.includes('-version');
    child.stdin = {
      writable: true,
      on: () => {},
      end: (b?: Buffer) => {
        if (b) stats.fedStdin.push(b);
      },
    };

    if (isProbe) {
      stats.probeCalls += 1;
      setImmediate(() => {
        if (config.probe === 'enoent') {
          const err = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
          child.emit('error', err);
          return;
        }
        child.emit('close', config.probe === 'fail' ? 1 : 0);
      });
      return child;
    }

    stats.decodeCalls += 1;
    setImmediate(() => {
      if (config.decodeStderr) child.stderr.emit('data', Buffer.from(config.decodeStderr));
      const samples = config.decodeSamples;
      if (samples && samples.length > 0) {
        child.stdout.emit('data', Buffer.from(samples.buffer.slice(0)));
      }
      child.emit('close', config.decodeExit ?? 0);
    });
    return child;
  }) as unknown as typeof spawn;

  return {
    spawnImpl,
    get probeCalls() {
      return stats.probeCalls;
    },
    get decodeCalls() {
      return stats.decodeCalls;
    },
    get fedStdin() {
      return stats.fedStdin;
    },
  };
}

afterEach(() => __resetFfmpegProbeForTest());

describe('decodeViaFfmpeg', () => {
  it('decodes to Float32 samples via ffmpeg, feeding the input on stdin', async () => {
    const expected = Float32Array.from([0, 0.25, -0.5, 0.999]);
    const fake = makeFakeSpawn({ probe: 'ok', decodeSamples: expected });
    const input = new Uint8Array([1, 2, 3, 4]);
    const out = await decodeViaFfmpeg(input, fake.spawnImpl);
    expect(Array.from(out)).toEqual(Array.from(expected));
    expect(fake.probeCalls).toBe(1);
    expect(fake.decodeCalls).toBe(1);
    expect(fake.fedStdin[0]!.equals(Buffer.from(input))).toBe(true);
  });

  it('throws a clear PLUGIN_LOAD_FAILED error with an install hint when ffmpeg is missing', async () => {
    const fake = makeFakeSpawn({ probe: 'enoent' });
    await expect(decodeViaFfmpeg(new Uint8Array([1]), fake.spawnImpl)).rejects.toMatchObject({
      code: 'PLUGIN_LOAD_FAILED',
    });
    expect(fake.decodeCalls).toBe(0); // never attempted the decode
  });

  it('surfaces a non-zero ffmpeg exit as an INTERNAL error carrying stderr', async () => {
    const fake = makeFakeSpawn({
      probe: 'ok',
      decodeSamples: null,
      decodeExit: 1,
      decodeStderr: 'Invalid data found when processing input',
    });
    await expect(decodeViaFfmpeg(new Uint8Array([9]), fake.spawnImpl)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('errors when ffmpeg exits 0 but produces no audio', async () => {
    const fake = makeFakeSpawn({ probe: 'ok', decodeSamples: null, decodeExit: 0 });
    await expect(decodeViaFfmpeg(new Uint8Array([9]), fake.spawnImpl)).rejects.toThrow(
      /produced no audio/,
    );
  });
});

describe('missingFfmpegError', () => {
  it('is a PLUGIN_LOAD_FAILED MoxxyError naming ffmpeg and an install command', () => {
    const err = missingFfmpegError();
    expect(err.code).toBe('PLUGIN_LOAD_FAILED');
    expect(err.message).toMatch(/ffmpeg/i);
    expect(err.hint).toMatch(/install/i);
  });
});
