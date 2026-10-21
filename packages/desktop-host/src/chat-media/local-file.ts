import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Local files only, decoded for the host's filesystem; remote shares stay out. */
export function localMediaFilePath(href: string, windows = process.platform === 'win32'): string | null {
  if (href.startsWith('file:')) {
    try {
      const url = new URL(href);
      if (url.host !== '' && url.host !== 'localhost') return null;
      return fileURLToPath(url, { windows });
    } catch {
      return null;
    }
  }
  if (href.startsWith('//') || href.startsWith('\\\\')) return null;
  return (windows ? path.win32 : path.posix).isAbsolute(href) ? href : null;
}
