import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFfmpegArgs,
  checkVoiceCaptureAvailable,
  startVoiceRecording,
} from './voice-input.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFakeFfmpeg(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-ffmpeg-'));
  tempDirs.push(dir);
  const executable = path.join(dir, 'ffmpeg');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
process.stdout.write(Buffer.from([1, 2, 3, 4]), () => {
  readFileSync(0);
});
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  return executable;
}

/** Fake ffmpeg that streams many small PCM chunks until told to quit, so we
 *  can exercise the capture-byte ceiling (the cutoff writes 'q' to stdin). */
async function makeFakeFfmpegStreaming(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-ffmpeg-stream-'));
  tempDirs.push(dir);
  const executable = path.join(dir, 'ffmpeg');
  await writeFile(
    executable,
    `#!/usr/bin/env node
let stop = false;
process.stdin.on('data', () => { stop = true; });
process.stdin.resume();
const tick = () => {
  if (stop) { process.exit(0); return; }
  // 8 bytes per tick.
  process.stdout.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), () => setTimeout(tick, 1));
};
tick();
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  return executable;
}

async function makeFakeFfmpegVersion(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-ffmpeg-version-'));
  tempDirs.push(dir);
  const executable = path.join(dir, 'ffmpeg');
  await writeFile(
    executable,
    `#!/usr/bin/env node
if (process.argv.includes('-version')) {
  process.stdout.write('ffmpeg version test');
  process.exit(0);
}
process.exit(1);
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  return executable;
}

describe('buildFfmpegArgs', () => {
  it('uses the system default input device on macOS', () => {
    expect(buildFfmpegArgs('darwin')).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-i',
      ':default',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-f',
      's16le',
      '-',
    ]);
  });

  it('can target a specific macOS audio device', () => {
    expect(buildFfmpegArgs({ platform: 'darwin', audioDevice: ':1' })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-i',
      ':1',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-f',
      's16le',
      '-',
    ]);
  });

  it('uses dshow on Windows', () => {
    expect(buildFfmpegArgs('win32')).toContain('audio=default');
  });

  it('keeps Linux as pulse best-effort', () => {
    expect(buildFfmpegArgs('linux')).toContain('pulse');
  });
});

describe('startVoiceRecording', () => {
  it('collects stdout PCM bytes and stops ffmpeg with q before kill fallback', async () => {
    const executable = await makeFakeFfmpeg();

    const recording = await startVoiceRecording({
      command: executable,
      platform: 'darwin',
      stopTimeoutMs: 2_000,
    });

    const pcm = await recording.stop();

    expect([...pcm]).toEqual([1, 2, 3, 4]);
  });

  it('reports missing ffmpeg without crashing the caller', async () => {
    await expect(startVoiceRecording({ command: '/definitely/missing/ffmpeg', platform: 'darwin' }))
      .rejects
      .toThrow(/ffmpeg/i);
  });

  it('bounds the captured PCM at the byte ceiling and stops ffmpeg (no unbounded buffer)', async () => {
    const executable = await makeFakeFfmpegStreaming();

    const recording = await startVoiceRecording({
      command: executable,
      platform: 'darwin',
      stopTimeoutMs: 2_000,
      // Tiny ceiling so the runaway stream is cut off almost immediately.
      maxCaptureBytes: 64,
    });

    const pcm = await recording.stop();

    // Buffering halted at/under the ceiling rather than growing without bound,
    // and the fake ffmpeg actually exited (stop() resolved instead of timing
    // out into a SIGKILL with an empty buffer).
    expect(pcm.byteLength).toBeGreaterThan(0);
    expect(pcm.byteLength).toBeLessThanOrEqual(64);
  });
});

describe('checkVoiceCaptureAvailable', () => {
  it('reports ffmpeg capture as ready when the executable responds', async () => {
    const executable = await makeFakeFfmpegVersion();

    await expect(checkVoiceCaptureAvailable({ command: executable })).resolves.toEqual({
      ready: true,
      issues: [],
    });
  });

  it('returns a requirement issue when ffmpeg is missing', async () => {
    await expect(
      checkVoiceCaptureAvailable({ command: '/definitely/missing/ffmpeg', timeoutMs: 500 }),
    ).resolves.toMatchObject({
      ready: false,
      issues: [
        {
          requirement: { kind: 'runtime', name: 'voice:capture:ffmpeg', state: 'ready' },
          code: 'not_ready',
          message: 'ffmpeg is required for voice input',
        },
      ],
    });
  });
});
