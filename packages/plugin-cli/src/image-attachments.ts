import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { UserPromptAttachment } from '@moxxy/sdk';

/**
 * Pasted-image detection for the TUI prompt. Modern terminals deliver
 * drag-dropped files (and pasted "Copy as Path" payloads) as plain text
 * — usually a single absolute path. Detect that shape so we can swap
 * the path for an `[Image #N]` placeholder and side-load the bytes.
 *
 * Conservative on purpose: a paste only counts as an image if the
 * trimmed payload is a single token that looks like a path and ends
 * with a known image extension. Multi-line prose and ordinary text
 * pastes flow through unchanged.
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** Strip surrounding quotes and backslash-escaped spaces from a path. */
function unescapeShellPath(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\ /g, ' ');
  // file:// URIs (some terminals on Linux paste this on drag-drop)
  if (s.startsWith('file://')) {
    try {
      s = decodeURI(s.slice('file://'.length));
    } catch {
      // leave as-is on bad encoding
    }
  }
  return s;
}

export interface DetectedImagePath {
  readonly absPath: string;
  readonly mediaType: string;
  readonly name: string;
}

/**
 * Return the resolved image path if `pasted` looks like a single file
 * path to an image. Otherwise null. Caller does the I/O.
 */
export function detectPastedImagePath(pasted: string): DetectedImagePath | null {
  const candidate = unescapeShellPath(pasted);
  // Path-shaped: starts with `/`, `~`, or a Windows drive letter. No
  // embedded newlines (drag-drop is always a single line).
  if (!candidate || candidate.includes('\n')) return null;
  if (!/^(?:\/|~\/|[A-Za-z]:\\)/.test(candidate)) return null;
  const ext = path.extname(candidate).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;
  let expanded = candidate;
  if (candidate.startsWith('~/')) {
    // Use os.homedir() (not $HOME, which is unset in some daemon/CI/Windows
    // contexts) and bail rather than silently producing a bare relative path
    // that would later read an unintended file under process.cwd().
    const home = homedir();
    if (!home) return null;
    expanded = path.join(home, candidate.slice(2));
  }
  const mediaType = MEDIA_TYPE_BY_EXT[ext];
  if (!mediaType) return null;
  return { absPath: expanded, mediaType, name: path.basename(expanded) };
}

/**
 * Read an image off disk into a base64 attachment ready for the
 * provider stream. Throws if the file is unreadable — caller surfaces.
 */
export async function loadImageAttachment(detected: DetectedImagePath): Promise<UserPromptAttachment> {
  const buf = await readFile(detected.absPath);
  return {
    kind: 'image',
    content: buf.toString('base64'),
    mediaType: detected.mediaType,
    name: detected.name,
  };
}

/**
 * Pull every `[Image #N]` placeholder out of the buffer in document
 * order so the host can pair them with previously-registered attachment
 * promises.
 */
export function extractImagePlaceholders(buffer: string): ReadonlyArray<number> {
  const re = /\[Image #(\d+)\]/g;
  const ids: number[] = [];
  for (let m = re.exec(buffer); m; m = re.exec(buffer)) {
    ids.push(Number(m[1]));
  }
  return ids;
}
