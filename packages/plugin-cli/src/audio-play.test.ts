import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAudioPlayerProbeForTest,
  checkAudioPlaybackAvailable,
  playAudio,
  selectAudioPlayer,
} from './audio-play.js';

/** A controllable stand-in for a spawned player/probe child. `kill` emits a
 *  `close` so an abort/timeout drives the play promise to resolution. */
class FakeChild extends EventEmitter {
  killed = false;
  readonly killSignals: string[] = [];
  cmd = '';
  args: string[] = [];
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignals.push(String(signal ?? 'SIGTERM'));
    this.emit('close', null, signal ?? null);
    return true;
  }
}

/** Fake spawn that records every child so a test can drive its lifecycle. */
function makeSpawn(onSpawn?: (child: FakeChild) => void): {
  spawnImpl: typeof spawn;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  const spawnImpl = ((cmd: string, args: string[]) => {
    const child = new FakeChild();
    child.cmd = cmd;
    child.args = args;
    children.push(child);
    onSpawn?.(child);
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, children };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

async function waitForChild(children: FakeChild[]): Promise<FakeChild> {
  const start = Date.now();
  while (children.length === 0) {
    if (Date.now() - start > 2_000) throw new Error('player was never spawned');
    await flush();
  }
  return children[0]!;
}

beforeEach(() => __resetAudioPlayerProbeForTest());
afterEach(() => __resetAudioPlayerProbeForTest());

describe('selectAudioPlayer — per-platform player pick', () => {
  const all = () => true;

  it('darwin picks afplay for WAV/MP3', async () => {
    const r = await selectAudioPlayer('darwin', 'audio/wav', all);
    expect(r).toMatchObject({ ok: true, command: 'afplay' });
    const mp3 = await selectAudioPlayer('darwin', 'audio/mpeg', all);
    expect(mp3).toMatchObject({ ok: true, command: 'afplay' });
  });

  it('darwin falls back to ffplay for OGG/Opus (afplay can’t decode it)', async () => {
    const r = await selectAudioPlayer('darwin', 'audio/ogg', all);
    expect(r).toMatchObject({ ok: true, command: 'ffplay' });
    // afplay-only host + opus → nothing can play it.
    const only = await selectAudioPlayer('darwin', 'audio/ogg', (c) => c === 'afplay');
    expect(only).toEqual({ ok: false, reason: 'no-player' });
  });

  it('linux prefers paplay, then aplay (WAV only), then ffplay', async () => {
    expect(await selectAudioPlayer('linux', 'audio/wav', all)).toMatchObject({
      ok: true,
      command: 'paplay',
    });
    // No paplay → aplay handles WAV.
    expect(
      await selectAudioPlayer('linux', 'audio/wav', (c) => c !== 'paplay'),
    ).toMatchObject({ ok: true, command: 'aplay' });
    // MP3 with no paplay → aplay can't (WAV only), so ffplay.
    expect(
      await selectAudioPlayer('linux', 'audio/mpeg', (c) => c !== 'paplay'),
    ).toMatchObject({ ok: true, command: 'ffplay' });
  });

  it('win32 uses PowerShell for WAV, ffplay for other formats', async () => {
    expect(await selectAudioPlayer('win32', 'audio/wav', all)).toMatchObject({
      ok: true,
      command: 'powershell',
    });
    expect(await selectAudioPlayer('win32', 'audio/mpeg', all)).toMatchObject({
      ok: true,
      command: 'ffplay',
    });
    // Non-WAV with no ffplay installed → nothing to play it.
    expect(
      await selectAudioPlayer('win32', 'audio/mpeg', (c) => c === 'powershell'),
    ).toEqual({ ok: false, reason: 'no-player' });
  });

  it('ffplay is invoked headless + auto-exit', async () => {
    const r = await selectAudioPlayer('linux', 'audio/mpeg', (c) => c === 'ffplay');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.buildArgs('/tmp/x.mp3')).toEqual([
        '-nodisp',
        '-autoexit',
        '-loglevel',
        'quiet',
        '/tmp/x.mp3',
      ]);
    }
  });
});

describe('playAudio', () => {
  it('plays via the picked player and resolves ok on a clean exit', async () => {
    const { spawnImpl, children } = makeSpawn();
    const p = playAudio(new Uint8Array([1, 2, 3]), {
      mimeType: 'audio/wav',
      platform: 'darwin',
      isAvailable: () => true,
      spawnImpl,
    });
    const child = await waitForChild(children);
    expect(child.cmd).toBe('afplay');
    child.emit('close', 0);
    expect(await p).toEqual({ ok: true, player: 'afplay' });
  });

  it('returns no-player when nothing is installed (never spawns)', async () => {
    const { spawnImpl, children } = makeSpawn();
    const result = await playAudio(new Uint8Array([1]), {
      mimeType: 'audio/wav',
      platform: 'linux',
      isAvailable: () => false,
      spawnImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'no-player' });
    expect(children).toHaveLength(0);
  });

  it('kills the player and reports aborted when the signal fires', async () => {
    const { spawnImpl, children } = makeSpawn();
    const controller = new AbortController();
    const p = playAudio(new Uint8Array([1]), {
      mimeType: 'audio/wav',
      platform: 'darwin',
      isAvailable: () => true,
      spawnImpl,
      signal: controller.signal,
    });
    const child = await waitForChild(children);
    controller.abort();
    expect(child.killed).toBe(true);
    expect(child.killSignals).toContain('SIGKILL');
    expect(await p).toEqual({ ok: false, reason: 'aborted' });
  });

  it('reports failed on a non-zero player exit', async () => {
    const { spawnImpl, children } = makeSpawn();
    const p = playAudio(new Uint8Array([1]), {
      mimeType: 'audio/wav',
      platform: 'darwin',
      isAvailable: () => true,
      spawnImpl,
    });
    const child = await waitForChild(children);
    child.emit('close', 1);
    const result = await p;
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('reports aborted (without spawning) when the signal is already aborted', async () => {
    const { spawnImpl, children } = makeSpawn();
    const result = await playAudio(new Uint8Array([1]), {
      mimeType: 'audio/wav',
      platform: 'darwin',
      isAvailable: () => true,
      spawnImpl,
      signal: AbortSignal.abort(),
    });
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(children).toHaveLength(0);
  });
});

describe('checkAudioPlaybackAvailable — probe caching', () => {
  it('probes each command once and caches the result', async () => {
    const { spawnImpl, children } = makeSpawn((child) => {
      // A successful spawn = the binary exists.
      setImmediate(() => child.emit('spawn'));
    });
    const first = await checkAudioPlaybackAvailable({ platform: 'darwin', spawnImpl });
    const second = await checkAudioPlaybackAvailable({ platform: 'darwin', spawnImpl });

    expect(first).toMatchObject({ available: true, player: 'afplay' });
    expect(second).toMatchObject({ available: true, player: 'afplay' });
    // afplay is the first darwin candidate, so only it is probed — and the
    // second call reuses the cached probe (no second spawn).
    expect(children.map((c) => c.cmd)).toEqual(['afplay']);
  });

  it('reports unavailable when no player binary exists', async () => {
    const { spawnImpl } = makeSpawn((child) => {
      setImmediate(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
    });
    const result = await checkAudioPlaybackAvailable({ platform: 'linux', spawnImpl });
    expect(result).toEqual({ available: false, player: null, platform: 'linux' });
  });
});
