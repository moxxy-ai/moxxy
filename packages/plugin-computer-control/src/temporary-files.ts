import { rm } from 'node:fs/promises';

export async function withTemporaryFiles<T>(paths: readonly string[], work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    await Promise.all(paths.map((path) => rm(path, { force: true })));
  }
}
