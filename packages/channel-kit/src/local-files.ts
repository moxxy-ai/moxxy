import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface LocalFile {
  readonly name: string;
  readonly path: string;
  readonly data: Buffer;
}

export interface ReadLocalFilesOptions {
  /** Relative paths resolve against it (the session's cwd). */
  readonly cwd: string;
  /** What the messenger accepts in one message, all files together. */
  readonly maxTotalBytes: number;
  readonly service: string;
  /** The limit as the error names it (`10 MB per bot message`). */
  readonly limitLabel: string;
}

/**
 * Read the files the agent attaches to a message, refusing anything the
 * messenger would reject — before any request goes out.
 */
export async function readLocalFiles(
  paths: ReadonlyArray<string>,
  opts: ReadLocalFilesOptions,
): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  let total = 0;
  for (const raw of paths) {
    const expanded = raw === '~' || raw.startsWith('~/') ? path.join(homedir(), raw.slice(1)) : raw;
    const full = path.resolve(opts.cwd, expanded);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw new Error(`${raw} is not a file`);
    total += info.size;
    if (total > opts.maxTotalBytes) {
      const mb = (total / (1024 * 1024)).toFixed(1);
      throw new Error(
        `attachments total ${mb} MB — ${opts.service} accepts at most ${opts.limitLabel}; share a smaller file or a link instead`,
      );
    }
    files.push({ name: path.basename(full), path: full, data: await readFile(full) });
  }
  return files;
}
