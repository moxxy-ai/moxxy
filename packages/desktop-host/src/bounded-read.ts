import { constants, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

// POSIX-only; Node leaves it undefined on Windows.
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Read a regular file, rejecting symlinks and anything larger than `limit`.
 *
 * The type and size checks run against the open handle rather than the path,
 * so what gets validated is the same inode that is then read. `lstat` followed
 * by `readFile` leaves a window in which the path can be repointed at another
 * file, which defeats both guards. ENOENT is left to the caller.
 */
export async function readBoundedFile(file: string, limit: number, invalid: string): Promise<Buffer> {
  // Without O_NOFOLLOW the symlink rejection has to stay a pre-check, but the
  // size and type guarantees still come from the handle.
  if (O_NOFOLLOW === 0 && (await fs.lstat(file)).isSymbolicLink()) throw new Error(invalid);
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(file, constants.O_RDONLY | O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error(invalid);
    return await handle.readFile();
  } catch (error) {
    // O_NOFOLLOW reports a symlink as ELOOP.
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error(invalid);
    throw error;
  } finally {
    await handle?.close();
  }
}
