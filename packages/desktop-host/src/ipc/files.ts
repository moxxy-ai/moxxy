/**
 * Local files the chat links to (`files.open`). The link is agent-authored, so
 * opening it must never RUN anything: only document / media / image types go
 * to their default app; scripts, apps, installers, unknown types and folders
 * (an `.app` bundle is a folder) are only revealed in the file manager, where
 * the user decides. `file:` URLs never reach `shell.openExternal`.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import { handle, IpcError } from './shared';

/** Types whose default app only views or plays them. */
const OPENABLE = new Set([
  // video
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi',
  // audio
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tif', 'tiff',
  // documents + data
  'pdf', 'txt', 'md', 'csv', 'json', 'log', 'rtf', 'epub',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'pages', 'numbers', 'key',
]);

export interface FilesHandlerDependencies {
  /** Open with the default app; resolves to an error message ('' on success). */
  readonly openPath: (p: string) => Promise<string>;
  readonly showItemInFolder: (p: string) => void;
}

export function registerFilesHandlers(
  dependencies: FilesHandlerDependencies = {
    openPath: (p) => shell.openPath(p),
    showItemInFolder: (p) => shell.showItemInFolder(p),
  },
): void {
  handle('files.open', async ({ path: target }) => {
    if (!path.isAbsolute(target)) throw new IpcError('invalid-payload', 'expected an absolute path');
    const full = path.normalize(target);
    const info = await stat(full).catch(() => null);
    if (!info) throw new IpcError('runner-error', `file not found: ${full}`);
    const ext = path.extname(full).slice(1).toLowerCase();
    if (info.isFile() && OPENABLE.has(ext)) {
      const error = await dependencies.openPath(full);
      if (error) throw new IpcError('runner-error', error);
      return { opened: 'app' as const };
    }
    dependencies.showItemInFolder(full);
    return { opened: 'folder' as const };
  });
}
