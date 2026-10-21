import { api } from '@moxxy/client-core';

/**
 * Links the agent writes to files on this machine — `file:///…` URLs or bare
 * absolute paths. They must not go through `target="_blank"`: markdown
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
      return decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  return href.startsWith('/') && !href.startsWith('//') ? decodeEscapes(href) : null;
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
