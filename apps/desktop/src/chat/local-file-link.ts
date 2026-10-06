import { api } from '@moxxy/client-core';

/**
 * Links the agent writes to files on this machine — `file:///…` URLs or bare
 * absolute paths. They must not go through `target="_blank"`: markdown
 * sanitizing empties a `file:` href and a bare path resolves against the app's
 * own URL, so either way the click opened the app itself in the OS browser.
 * They open through `files.open` instead.
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
  return href.startsWith('/') && !href.startsWith('//') ? href : null;
}

/** Ask the host to open (or reveal) a linked local file. */
export function openLocalFile(filePath: string): void {
  void api()
    .invoke('files.open', { path: filePath })
    .catch(() => undefined);
}
