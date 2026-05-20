import { promises as fs } from 'node:fs';
import { clampString, resolveSafe } from './util.js';

/**
 * Pure handler module for the Read tool. Lives in its own file so the
 * worker_threads isolator (`@moxxy/isolator-worker`) can re-import it
 * on the worker side via the `handlerModule` reference declared in
 * `read.ts`.
 *
 * Closures can't cross thread boundaries; module exports can.
 */
export interface ReadInput {
  readonly file_path: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ReadCtxLike {
  readonly cwd: string;
}

export async function readHandler(input: ReadInput, ctx: ReadCtxLike): Promise<string> {
  const { file_path, offset = 0, limit = 2000 } = input;
  const resolved = resolveSafe(ctx.cwd, file_path);
  const buf = await fs.readFile(resolved);
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  const sliced = lines.slice(offset, offset + limit);
  const numbered = sliced
    .map((line, i) => `${String(offset + i + 1).padStart(6, ' ')}\t${line}`)
    .join('\n');
  return clampString(numbered, 200_000);
}
