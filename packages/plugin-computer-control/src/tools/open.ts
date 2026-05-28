import { defineTool, MoxxyError, z } from '@moxxy/sdk';
import { ensureDarwin, runProcess } from '../shell.js';

export const openTool = defineTool({
  name: 'computer_open',
  description:
    'Open a URL, file path, or .app bundle via macOS `open`. Use this to ' +
    'launch / activate a specific app or jump to a web page. The model should ' +
    'prefer this over typing into Spotlight when the target is known.',
  inputSchema: z.object({
    target: z
      .string()
      .min(1)
      .describe(
        'URL (https://...), file path (/Users/...), or app name (Safari). ' +
          'For app names, prefer the `app` field — `target` is treated as a path.',
      )
      .optional(),
    app: z
      .string()
      .min(1)
      .max(120)
      .describe(
        'Application name to activate (e.g. "Safari", "Visual Studio Code"). ' +
          'When `target` is also set, the app opens `target` (e.g. open a file in VS Code).',
      )
      .optional(),
  }),
  permission: { action: 'prompt' },
  async handler({ target, app }, ctx) {
    ensureDarwin('computer_open');
    if (!target && !app) {
      throw new MoxxyError({
        code: 'INTERNAL',
        message: 'computer_open: at least one of `target` or `app` is required',
        context: { tool: 'computer_open' },
      });
    }
    const args: string[] = [];
    if (app) {
      args.push('-a', app);
    }
    if (target) {
      args.push(target);
    }
    const proc = await runProcess('open', args, {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      timeoutMs: 10_000,
    });
    if (proc.exitCode !== 0) {
      throw new MoxxyError({
        code: 'INTERNAL',
        message: `open failed (exit ${proc.exitCode}): ${proc.stderr.trim() || '(no error message)'}`,
        context: { tool: 'computer_open', exitCode: proc.exitCode },
      });
    }
    return { ok: true, app, target };
  },
});
