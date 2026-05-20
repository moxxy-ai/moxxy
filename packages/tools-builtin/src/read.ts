import { defineTool, z } from '@moxxy/sdk';
import { readHandler } from './read-handler.js';

export const readTool = defineTool({
  name: 'Read',
  description: 'Read a UTF-8 text file from disk. Returns lines as `cat -n` style numbered text.',
  inputSchema: z.object({
    file_path: z.string().describe('Absolute path or path relative to cwd.'),
    offset: z.number().int().nonnegative().optional().describe('Line offset (0-based).'),
    limit: z.number().int().positive().max(5000).optional().describe('Max lines to return.'),
  }),
  permission: { action: 'prompt' },
  compact: {
    verb: 'Reading',
    noun: { one: 'file', other: 'files' },
    previewKey: 'file_path',
  },
  isolation: {
    capabilities: {
      fs: { read: ['$cwd/**'] },
      net: { mode: 'none' },
      timeMs: 30_000,
    },
    // Module reference lets out-of-process isolators
    // (`@moxxy/isolator-worker`, future subprocess/wasm) re-import the
    // handler outside the main thread. Closure handler below is what
    // `inproc` / `none` use.
    handlerModule: {
      url: new URL('./read-handler.js', import.meta.url).href,
      export: 'readHandler',
    },
  },
  handler: readHandler,
});
