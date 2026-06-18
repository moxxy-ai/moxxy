import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { moxxyPath } from '@moxxy/sdk/server';
import type { DetectedImagePath } from './image-attachments.js';

/**
 * Pull an image off the system clipboard and write it to a cache file,
 * returning the path so the existing image-attachment pipeline can pick
 * it up. Returns null when:
 *   - the clipboard contains no image (text, empty, unsupported MIME)
 *   - the platform isn't supported
 *   - the helper binary isn't available
 *
 * Synchronous on purpose: the TUI's paste handler is sync, so this
 * runs in-line at paste time. The exec is bounded to a tight timeout
 * so a hung clipboard tool can't freeze input.
 */

const CACHE_DIR = moxxyPath('image-cache');

/** Reap clipboard PNGs older than this (the bytes are side-loaded into the
 *  attachment pipeline at paste time, so a short retention is plenty). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLIP_NAME_RE = /^clip-(\d+)-[a-z0-9]+\.png$/;

/**
 * Opportunistically delete stale cached clipboard images so the cache dir
 * can't grow forever over a long-lived install (every paste used to leak a
 * PNG with no TTL/cap). Best-effort: the embedded `clip-<ts>-` timestamp is
 * the primary age signal, falling back to the file's mtime; any error is
 * ignored so a sweep never breaks a paste.
 */
export function reapStale(dir: string, now: number = Date.now()): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = CLIP_NAME_RE.exec(name);
    if (!m) continue;
    const stamp = Number(m[1]);
    let age = Number.isFinite(stamp) ? now - stamp : Number.NaN;
    if (!Number.isFinite(age)) {
      try {
        age = now - statSync(path.join(dir, name)).mtimeMs;
      } catch {
        continue;
      }
    }
    if (age > CACHE_TTL_MS) {
      try {
        unlinkSync(path.join(dir, name));
      } catch {
        /* ignore — another process may have removed it */
      }
    }
  }
}

function ensureCacheDir(): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  reapStale(CACHE_DIR, Date.now());
  return CACHE_DIR;
}

function nextCachePath(): string {
  const dir = ensureCacheDir();
  return path.join(dir, `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
}

/**
 * macOS path — uses AppleScript via osascript to coerce the clipboard
 * to PNG and write it to a temp file. AppleScript's `«class PNGf»`
 * coercion fails if the clipboard isn't an image; we catch that and
 * return null.
 */
function readClipboardImageDarwin(): DetectedImagePath | null {
  const target = nextCachePath();
  // osascript exits non-zero when the AppleScript `try` block raises
  // (e.g. clipboard isn't an image). We don't care about the message —
  // null return signals "no image here, treat as a regular paste."
  const script = [
    'try',
    `  set imageFile to open for access (POSIX file "${target}") with write permission`,
    '  write (the clipboard as «class PNGf») to imageFile',
    '  close access imageFile',
    '  return "ok"',
    'on error errMsg',
    '  try',
    '    close access (POSIX file "' + target + '")',
    '  end try',
    '  return "no_image"',
    'end try',
  ];
  const args: string[] = [];
  for (const line of script) {
    args.push('-e', line);
  }
  const result = spawnSync('osascript', args, {
    encoding: 'utf8',
    timeout: 2000,
  });
  if (result.status !== 0 || result.stdout.trim() !== 'ok') {
    try {
      unlinkSync(target);
    } catch {
      /* ignore */
    }
    return null;
  }
  try {
    const stat = statSync(target);
    // AppleScript's PNG coercion can produce a 0-byte file when the
    // clipboard is "kind of image" but not actually decodable. Reject.
    if (stat.size === 0) {
      unlinkSync(target);
      return null;
    }
  } catch {
    return null;
  }
  return {
    absPath: target,
    mediaType: 'image/png',
    name: path.basename(target),
  };
}

/**
 * Linux path — try xclip first, then wl-paste (Wayland). Either tool
 * absent → return null. Both write PNG bytes to stdout, which we
 * capture as a Buffer.
 */
function readClipboardImageLinux(): DetectedImagePath | null {
  const tools: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] },
    { cmd: 'wl-paste', args: ['--type', 'image/png'] },
  ];
  for (const tool of tools) {
    const result = spawnSync(tool.cmd, tool.args, {
      encoding: 'buffer',
      timeout: 2000,
    });
    if (result.status === 0 && result.stdout && result.stdout.length > 0) {
      const target = nextCachePath();
      try {
        writeFileSync(target, result.stdout);
      } catch {
        return null;
      }
      return {
        absPath: target,
        mediaType: 'image/png',
        name: path.basename(target),
      };
    }
  }
  return null;
}

export function readClipboardImageSync(): DetectedImagePath | null {
  if (process.platform === 'darwin') return readClipboardImageDarwin();
  if (process.platform === 'linux') return readClipboardImageLinux();
  // Windows + others: not supported yet — fall through silently so the
  // paste behaves like a normal text paste.
  return null;
}
