import { promises as fs } from 'node:fs';
import { MoxxyError, defineTool, z } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import { buildFileDiffDisplay } from './file-diff.js';
import { MAX_FILE_BYTES, resolvePath } from './util.js';

export const writeTool = defineTool({
  name: 'Write',
  description: 'Write a UTF-8 file to disk, creating parent directories as needed. Overwrites if exists.',
  inputSchema: z.object({
    file_path: z.string(),
    content: z.string(),
  }),
  permission: { action: 'prompt' },
  compact: {
    verb: 'Writing',
    noun: { one: 'file', other: 'files' },
    previewKey: 'file_path',
  },
  isolation: {
    capabilities: {
      fs: { read: ['$cwd/**'], write: ['$cwd/**'] },
      net: { mode: 'none' },
      timeMs: 30_000,
    },
  },
  async handler({ file_path, content }, ctx) {
    const resolved = resolvePath(ctx.cwd, file_path);
    // Bail before touching disk if the turn was already aborted: a partial
    // write here would corrupt the user's file for no benefit.
    if (ctx.signal.aborted) {
      throw new MoxxyError({ code: 'ABORTED', message: `Write aborted before start: ${resolved}` });
    }
    // Read any existing content first so we can show a real diff (and tell
    // "create" from "overwrite"). Missing file → create from empty. Bound the
    // read so overwriting beside a huge existing blob can't OOM while building
    // the diff; past the cap we still overwrite but skip the before-content
    // diff (treat it as a create-style result).
    let before = '';
    let mode: 'create' | 'update' = 'create';
    try {
      const st = await fs.stat(resolved);
      mode = 'update';
      if (st.size <= MAX_FILE_BYTES) {
        before = await fs.readFile(resolved, 'utf8');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    // Atomic whole-file write (tmp + rename) so a crash/abort mid-write can't
    // leave a truncated file. writeFileAtomic creates parent dirs.
    await writeFileAtomic(resolved, content);
    // Rich result: the model gets a short summary line; channels render the
    // diff slices (line numbers, +/- markers, green/red backgrounds).
    return buildFileDiffDisplay({ cwd: ctx.cwd, absPath: resolved, before, after: content, mode });
  },
});
