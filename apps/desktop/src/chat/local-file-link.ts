import { api } from '@moxxy/client-core';

/**
 * Links the agent writes to files on this machine — `file:///…` URLs or bare
 * absolute paths, from macOS and Linux (`/Users/…`) or Windows (`C:\…`). They must not go through `target="_blank"`: markdown
 * sanitizing empties a `file:` href and a bare path resolves against the app's
 * own URL, so either way the click opened the app itself in the OS browser.
 * They open through `files.open` instead.
 *
 * Markdown escapes a link's destination (a space becomes `%20`), so a bare
 * path is decoded too, or a folder with a space in its name is never found.
 */
export function localFilePath(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith('file:')) {
    try {
      const url = new URL(href);
      if (url.host !== '' && url.host !== 'localhost') return null;
      // `file:///C:/x` has the path `/C:/x`; Windows has no file at `\C:\x`.
      return decodeURIComponent(url.pathname).replace(SLASH_BEFORE_DRIVE, '');
    } catch {
      return null;
    }
  }
  return isAbsoluteLocalPath(href) ? decodeEscapes(href) : null;
}

/** `C:\…` or `C:/…`: a path on a Windows drive. */
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/u;
const SLASH_BEFORE_DRIVE = /^\/(?=[A-Za-z]:[\\/])/u;

/**
 * A path from the root of this machine. A network path (`//server/share`,
 * `\\server\share`) is not one: opening it makes Windows sign in to that
 * server, which would hand the user's credentials to whoever the agent named.
 */
function isAbsoluteLocalPath(href: string): boolean {
  return (href.startsWith('/') && !href.startsWith('//')) || WINDOWS_DRIVE_PATH.test(href);
}

/** A `%` that does not start an escape (`100%.md`) leaves the path as written. */
function decodeEscapes(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Ask the host to open (or reveal) a linked local file; rejects with why it could not. */
export async function openLocalFile(filePath: string): Promise<void> {
  await api().invoke('files.open', { path: filePath });
}

/** What the chat says beside a link that did not open; the host's reason stays in the tooltip. */
export function fileFailureLabel(reason: string): string {
  return reason.includes('file not found') ? 'This file is not there' : 'Couldn’t open this file';
}

/** A link destination on a Windows drive: `](C:\…` or `](<C:\…`. */
const WINDOWS_LINK_DESTINATION = /\]\((<?)([A-Za-z]:\\[^)>\n]*)/gu;
const FENCE = /^\s*(?:```|~~~)/u;

/**
 * Markdown reads a backslash before punctuation as an escape and drops it, so
 * `[a](C:\Users\Jan\.config\a.md)` would reach the app as `C:\Users\Jan.config\a.md`,
 * a file that is not there. Before the text is parsed, a link to a Windows
 * drive gets forward slashes, which Windows reads the same. Code blocks keep
 * what was written.
 */
export function windowsLinkSlashes(markdown: string): string {
  if (!markdown.includes(':\\')) return markdown;
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(WINDOWS_LINK_DESTINATION, (_whole, angle: string, path: string) =>
        `](${angle}${path.replaceAll('\\', '/')}`);
    })
    .join('\n');
}
