import { defineTool, MoxxyError, z } from '@moxxy/sdk';
import { ensureDarwin, procFailureCause, runProcess } from '../shell.js';

export const clipboardTool = defineTool({
  name: 'computer_clipboard',
  description:
    'Read from or write to the macOS clipboard. Use `read` to fetch what the ' +
    'user just copied; use `write` to stage text the user can then paste with ' +
    '⌘V. Writing the clipboard does NOT trigger a paste — call computer_key ' +
    'with cmd+v after if you need to paste.',
  inputSchema: z.object({
    action: z.enum(['read', 'write']),
    text: z
      .string()
      .max(64_000)
      .optional()
      .describe('Text to put on the clipboard. Required when action="write".'),
  }),
  permission: { action: 'prompt' },
  isolation: {
    capabilities: {
      subprocess: true,
      commands: ['pbpaste', 'pbcopy'],
      net: { mode: 'none' },
      timeMs: 10_000,
    },
  },
  async handler({ action, text }, ctx) {
    ensureDarwin('computer_clipboard');
    if (action === 'read') {
      const proc = await runProcess('pbpaste', [], {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: 5_000,
      });
      if (proc.exitCode !== 0) {
        const cause = procFailureCause(proc, 5_000);
        throw new MoxxyError({
          code: 'TOOL_ERROR',
          message: cause
            ? `pbpaste ${cause}`
            : `pbpaste failed (exit ${proc.exitCode}): ${proc.stderr.trim()}`,
          context: { tool: 'computer_clipboard', exitCode: proc.exitCode, timedOut: proc.timedOut ? 1 : 0 },
        });
      }
      return { ok: true, text: proc.stdout };
    }
    if (text === undefined) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: 'computer_clipboard: `text` is required when action="write"',
        context: { tool: 'computer_clipboard' },
      });
    }
    const proc = await runProcess('pbcopy', [], {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      input: text,
      timeoutMs: 5_000,
    });
    if (proc.exitCode !== 0) {
      const cause = procFailureCause(proc, 5_000);
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: cause
          ? `pbcopy ${cause}`
          : `pbcopy failed (exit ${proc.exitCode}): ${proc.stderr.trim()}`,
        context: { tool: 'computer_clipboard', exitCode: proc.exitCode, timedOut: proc.timedOut ? 1 : 0 },
      });
    }
    return { ok: true, length: text.length };
  },
});
