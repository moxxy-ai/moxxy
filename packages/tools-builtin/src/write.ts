import { promises as fs } from 'node:fs';
import { MoxxyError, defineTool, writeFileAtomic, z } from '@moxxy/sdk';
import { buildFileDiffDisplay } from './file-diff.js';
import { resolvePath } from './util.js';

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
    // "create" from "overwrite"). Missing file → create from empty.
    let before = '';
    let mode: 'create' | 'update' = 'create';
    try {
      before = await fs.readFile(resolved, 'utf8');
      mode = 'update';
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
