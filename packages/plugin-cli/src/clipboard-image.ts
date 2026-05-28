import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { moxxyPath } from '@moxxy/sdk';
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

function ensureCacheDir(): string {
  mkdirSync(CACHE_DIR, { recursive: true });
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
        const fs = require('node:fs') as typeof import('node:fs');
        fs.writeFileSync(target, result.stdout);
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
