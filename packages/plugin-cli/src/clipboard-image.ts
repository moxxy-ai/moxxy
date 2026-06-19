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

/** Throttle the on-paste reap so it sweeps at most once per this interval —
 *  the sweep is synchronous (readdir + per-file stat/unlink) and runs on the
 *  TUI input thread, so doing it on EVERY paste froze keystroke handling on a
 *  large or network-mounted cache dir. */
const REAP_THROTTLE_MS = 5 * 60 * 1000;
/** Cap entries inspected per sweep so a pathologically large cache dir can't
 *  block input for an unbounded walk. */
const REAP_MAX_ENTRIES = 1_000;
let lastReapAt = 0;

/**
 * Opportunistically delete stale cached clipboard images so the cache dir
 * can't grow forever over a long-lived install (every paste used to leak a
 * PNG with no TTL/cap). Best-effort: the embedded `clip-<ts>-` timestamp is
 * the primary age signal, falling back to the file's mtime; any error is
 * ignored so a sweep never breaks a paste. Processes at most
 * {@link REAP_MAX_ENTRIES} entries per call so the synchronous walk stays
 * bounded on the input hot path.
 */
export function reapStale(dir: string, now: number = Date.now()): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  let inspected = 0;
  for (const name of entries) {
    if (inspected >= REAP_MAX_ENTRIES) break;
    const m = CLIP_NAME_RE.exec(name);
    if (!m) continue;
    inspected += 1;
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
  // Throttled: only sweep once per REAP_THROTTLE_MS so a burst of pastes
  // doesn't re-walk the whole cache dir on every keystroke-bearing paste.
  const now = Date.now();
  if (now - lastReapAt >= REAP_THROTTLE_MS) {
    lastReapAt = now;
    reapStale(CACHE_DIR, now);
  }
  return CACHE_DIR;
}

function nextCachePath(): string {
  const dir = ensureCacheDir();
  return path.join(dir, `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
}

/**
 * Escape a path for safe interpolation into an AppleScript double-quoted
 * string literal. `target` derives from moxxyPath() (= $MOXXY_HOME or
 * homedir() + a safe random filename); the directory prefix is
 * operator/OS-controlled, but a stray `"` or `\` would otherwise break out of
 * the literal and let the remainder run as AppleScript. Escape `\` first, then
 * `"` (order matters so we don't double-escape). Exported for testing.
 */
export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Build the osascript source that coerces the clipboard to PNG and writes it
 *  to `target`. Exported so the escaping can be verified without invoking
 *  osascript or depending on the module-frozen cache dir. */
export function buildDarwinClipboardScript(target: string): string[] {
  const targetLiteral = escapeAppleScriptString(target);
  return [
    'try',
    `  set imageFile to open for access (POSIX file "${targetLiteral}") with write permission`,
    '  write (the clipboard as «class PNGf») to imageFile',
    '  close access imageFile',
    '  return "ok"',
    'on error errMsg',
    '  try',
    '    close access (POSIX file "' + targetLiteral + '")',
    '  end try',
    '  return "no_image"',
    'end try',
  ];
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
  const script = buildDarwinClipboardScript(target);
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
