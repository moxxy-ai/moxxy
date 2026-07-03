import { defineTool, MoxxyError, z } from '@moxxy/sdk';
import { ensureDarwin, procFailureCause, runProcess } from '../shell.js';

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
  // `open` only messages LaunchServices: the file read / URL navigation happens
  // in the launched app, outside this process tree — hence net 'none'. The
  // broad fs.read is honest for this tool: any user-approved path is a
  // legitimate `target`, and the cap check validates path-shaped inputs
  // against these globs.
  isolation: {
    capabilities: {
      subprocess: true,
      commands: ['open'],
      fs: { read: ['/**'] },
      net: { mode: 'none' },
      timeMs: 15_000,
    },
  },
  async handler({ target, app }, ctx) {
    ensureDarwin('computer_open');
    if (!target && !app) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: 'computer_open: at least one of `target` or `app` is required',
        context: { tool: 'computer_open' },
      });
    }
    // A target/app beginning with '-' (e.g. '-g', '-n', '-W') is parsed by
    // /usr/bin/open as an OPTION FLAG, not a path/URL/app — silently changing
    // behavior (open in background, new instance) the user did not approve.
    // Reject it: no legitimate path/URL/app name starts with a dash, and
    // spawn is array-form so this is the only argument-injection vector.
    for (const [field, value] of [
      ['target', target],
      ['app', app],
    ] as const) {
      if (value !== undefined && value.startsWith('-')) {
        throw new MoxxyError({
          code: 'TOOL_ERROR',
          message: `computer_open: \`${field}\` must not begin with '-' (would be parsed as an option flag)`,
          context: { tool: 'computer_open', field },
        });
      }
    }
    const args: string[] = [];
    if (app) {
      args.push('-a', app);
    }
    // `--` ends option parsing so the positional target is treated strictly
    // as a path/URL operand even if a future change relaxes the guard above.
    if (target) {
      args.push('--', target);
    }
    const proc = await runProcess('open', args, {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      timeoutMs: 10_000,
    });
    if (proc.exitCode !== 0) {
      const cause = procFailureCause(proc, 10_000);
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: cause
          ? `open ${cause}`
          : `open failed (exit ${proc.exitCode}): ${proc.stderr.trim() || '(no error message)'}`,
        context: { tool: 'computer_open', exitCode: proc.exitCode, timedOut: proc.timedOut ? 1 : 0 },
      });
    }
    return { ok: true, app, target };
  },
});
