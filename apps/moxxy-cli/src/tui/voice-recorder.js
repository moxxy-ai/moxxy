import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileP = promisify(execFile);

/**
 * Check whether a binary is on PATH. Returns the absolute path, or null.
 */
async function which(name) {
  try {
    const { stdout } = await execFileP('which', [name]);
    const p = stdout.trim();
    return p || null;
  } catch {
    return null;
  }
}

/**
 * Detect an available recording tool. Prefers `sox` (via `rec`) because it
 * speaks WAV out of the box and handles Ctrl-C gracefully. Falls back to
 * `ffmpeg` with a platform-appropriate input device. Returns `null` if
 * neither is present.
 */
export async function detectRecorder() {
  const rec = await which('rec');
  if (rec) return { tool: 'rec', bin: rec };
  const sox = await which('sox');
  if (sox) return { tool: 'sox', bin: sox };
  const ffmpeg = await which('ffmpeg');
  if (ffmpeg) return { tool: 'ffmpeg', bin: ffmpeg };
  return null;
}

function ffmpegArgs(outPath) {
  const platform = process.platform;
  if (platform === 'darwin') {
    // `avfoundation` default audio input is `:0`.
    return ['-loglevel', 'error', '-f', 'avfoundation', '-i', ':0', '-ac', '1', '-ar', '16000', '-y', outPath];
  }
  // Linux: assume ALSA `default` — user can symlink their own if needed.
  return ['-loglevel', 'error', '-f', 'alsa', '-i', 'default', '-ac', '1', '-ar', '16000', '-y', outPath];
}

/**
 * Start a recording. Returns a handle with `stop()` that resolves to
 * `{ path, data, mime }`. The caller owns cleanup of the temp file via
 * `cleanup()`.
 *
 * The audio is written to a platform temp file so that even if the recorder
 * dies mid-stream we never lose the buffer.
 */
export async function startRecording() {
  const recorder = await detectRecorder();
  if (!recorder) {
    throw new Error('No recorder found. Install `sox` (recommended) or `ffmpeg`.');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moxxy-voice-'));
  const outPath = path.join(tmpDir, 'voice.wav');

  let args;
  if (recorder.tool === 'rec' || recorder.tool === 'sox') {
    // `rec` is sox with sensible defaults; `sox` requires `-d` for default input.
    args = recorder.tool === 'rec'
      ? ['-q', '-c', '1', '-r', '16000', outPath]
      : ['-q', '-d', '-c', '1', '-r', '16000', outPath];
  } else {
    args = ffmpegArgs(outPath);
  }

  const child = spawn(recorder.bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  let exited = false;
  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  return {
    tool: recorder.tool,
    outPath,
    async stop() {
      if (!exited) {
        // SIGINT is important: ffmpeg and sox both flush the output file
        // cleanly on SIGINT. SIGTERM/KILL can leave a truncated WAV header.
        try { child.kill('SIGINT'); } catch {}
      }
      await exitPromise;

      if (!fs.existsSync(outPath)) {
        throw new Error(`Recorder produced no output file. stderr: ${stderr.trim() || '<empty>'}`);
      }
      const data = fs.readFileSync(outPath);
      if (data.length < 44) {
        // 44 bytes is the minimum WAV header.
        throw new Error('Recording too short or empty.');
      }
      return { path: outPath, data, mime: 'audio/wav', filename: 'voice.wav' };
    },
    cleanup() {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}
