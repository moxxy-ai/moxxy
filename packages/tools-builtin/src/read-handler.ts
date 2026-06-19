import { promises as fs } from 'node:fs';
import { MoxxyError, type BrokeredFs } from '@moxxy/sdk';
import { clampString, MAX_FILE_BYTES, resolvePath } from './util.js';

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
  /** Capability-mediated fs. Present when invoked under an isolator that
   *  brokers (`@moxxy/isolator-worker`); absent under `none` / `inproc`. */
  readonly fs?: BrokeredFs;
}

export async function readHandler(input: ReadInput, ctx: ReadCtxLike): Promise<string> {
  const { file_path, offset = 0, limit = 2000 } = input;
  const resolved = resolvePath(ctx.cwd, file_path);
  // Refuse to slurp a file that exceeds the working-set cap. Without this the
  // whole file (and a per-line array of it) is materialized in the heap before
  // any output clamp — a multi-hundred-MB log / db / media blob OOM-kills the
  // process on a path the model invokes constantly. (Grep already guards this.)
  try {
    const st = ctx.fs ? await ctx.fs.stat(resolved) : await fs.stat(resolved);
    if (st.size > MAX_FILE_BYTES) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: `Read: file too large — ${st.size} bytes (max ${MAX_FILE_BYTES}). Use Grep, or narrow with offset/limit on a smaller file.`,
      });
    }
  } catch (e) {
    // Re-throw our own size error; let a genuine stat failure (missing file,
    // perms) fall through to readFile so its error message is preserved.
    if (e instanceof MoxxyError) throw e;
  }
  // Use the brokered fs when the isolator provides one. The broker
  // re-validates the path against the tool's declared `caps.fs.read`
  // on the parent side, so reads outside the cap are denied at the
  // boundary regardless of what's in the input. Without a broker
  // (inproc / none), fall back to direct `node:fs` — input-level
  // cap-check already screened the file_path.
  const text = ctx.fs
    ? await ctx.fs.readFile(resolved, { encoding: 'utf8' })
    : (await fs.readFile(resolved)).toString('utf8');
  const lines = text.split('\n');
  const sliced = lines.slice(offset, offset + limit);
  const numbered = sliced
    .map((line, i) => `${String(offset + i + 1).padStart(6, ' ')}\t${line}`)
    .join('\n');
  return clampString(numbered, 200_000);
}
