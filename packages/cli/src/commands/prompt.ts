import { collectTurn, createAllowListResolver, denyByDefaultResolver, runTurn } from '@moxxy/core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { setupSessionWithConfig } from '../setup.js';
import { closeSession } from '../setup/close-session.js';
import { argvToSetupOptions, hasBoolFlag, helpRequested, stringFlag } from '../argv-helpers.js';
import { printError } from '../errors.js';
import type { ParsedArgv } from '../argv.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy -p',
  tagline: 'run one task and print the result without opening the TUI',
  sections: [
    {
      title: 'USAGE',
      rows: [
        ['moxxy -p "task"', 'ask once and print plain text'],
        ['--model <id>', 'use a different model for this invocation'],
        ['--output-format <fmt>', 'text, json, or stream-json'],
        ['--allow-tools <list>', 'allow only the comma-separated tools named here'],
        ['--allow-all', 'allow every tool for this invocation: the conversation\'s auto-approve'],
      ],
    },
  ],
  footer: ['Without an allow flag, consequential tools remain denied.'],
});

export async function runPromptCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }

  const prompt = stringFlag(argv, 'p') ?? stringFlag(argv, 'prompt') ?? '';
  if (!prompt) {
    printError('-p/--prompt requires a non-empty string');
    return 2;
  }

  const stdinBuf = await readStdinIfPiped();
  const fullPrompt = stdinBuf ? `${prompt}\n\n${stdinBuf}` : prompt;

  const allowTools = parseList(argv.flags['allow-tools']);
  const allowAll = hasBoolFlag(argv, 'allow-all');
  const outputFormat = parseOutputFormat(stringFlag(argv, 'output-format'));
  if (outputFormat === null) {
    printError(`--output-format must be one of: ${OUTPUT_FORMATS.join(', ')}`);
    return 2;
  }
  const model = stringFlag(argv, 'model');

  // For --allow-all, derive the allow-list from the active session's tools
  // rather than hardcoding a stale snapshot. We boot the session first with
  // deny-by-default, look at tools, then swap to the all-tools resolver.
  // For the common case (no --allow-all) we can wire the resolver inline.
  const resolver = allowAll
    ? denyByDefaultResolver
    : allowTools.length > 0
      ? createAllowListResolver(allowTools)
      : denyByDefaultResolver;

  const { session, persistence, audit } = await setupSessionWithConfig({
    ...argvToSetupOptions(argv),
    resolver,
  });

  if (allowAll) {
    const everyTool = session.tools.list().map((t) => t.name);
    session.setPermissionResolver(createAllowListResolver(everyTool));
    // Recorded in the log like the desktop's switch, so tools that read it (Computer Use's access levels) see it too.
    await session.setAutoApprove(true);
  }

  // Ctrl+C / kill must still close the session: that is what stops the
  // background jobs the run started. Dying on the default signal action skips
  // every shutdown hook and orphans them.
  const releaseSignals = closeOnSignal(() => closeSession(session, persistence, audit));
  let exitCode = 0;
  try {
    if (outputFormat === 'text') {
      for await (const event of runTurn(session, fullPrompt, model ? { model } : {})) {
        if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
        if (event.type === 'tool_call_denied') {
          printError(`tool denied: ${event.reason}`);
          exitCode = 1;
        }
        if (event.type === 'error') {
          printError(event.message);
          exitCode = 1;
        }
      }
      process.stdout.write('\n');
    } else if (outputFormat === 'stream-json') {
      for await (const event of runTurn(session, fullPrompt, model ? { model } : {})) {
        process.stdout.write(JSON.stringify(event) + '\n');
        if (event.type === 'tool_call_denied' || event.type === 'error') exitCode = 1;
      }
    } else {
      const events = await collectTurn(session, fullPrompt, model ? { model } : {});
      process.stdout.write(JSON.stringify(events, null, 2) + '\n');
      if (events.some((e: MoxxyEvent) => e.type === 'tool_call_denied' || e.type === 'error')) exitCode = 1;
    }
  } catch (err) {
    printError(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  } finally {
    releaseSignals();
    // Drain persistence (last event + final index row) then fire onShutdown
    // hooks / stop daemons so the process exits promptly. Best-effort — never
    // masks the command's exit code.
    await closeSession(session, persistence, audit);
  }
  return exitCode;
}

/** Upper bound on the signal-time close, so a stuck hook can't keep the process alive. */
const SIGNAL_CLOSE_GRACE_MS = 6_000;

/**
 * On the first SIGINT/SIGTERM, close the session and exit with the signal's
 * conventional code. The handlers are one-shot, so a second Ctrl+C falls back
 * to the default action and exits at once. Returns the unregister.
 */
function closeOnSignal(close: () => Promise<void>): () => void {
  const onSignal = (signal: NodeJS.Signals): void => {
    release();
    const code = signal === 'SIGINT' ? 130 : 143;
    setTimeout(() => process.exit(code), SIGNAL_CLOSE_GRACE_MS).unref();
    void close().finally(() => process.exit(code));
  };
  const release = (): void => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return release;
}

const OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Validate the --output-format flag. Returns the default `'text'` when
 *  unset, or null for an unrecognized value (so the caller can error). */
export function parseOutputFormat(raw: string | undefined): OutputFormat | null {
  if (raw === undefined) return 'text';
  return (OUTPUT_FORMATS as readonly string[]).includes(raw) ? (raw as OutputFormat) : null;
}

function parseList(v: unknown): string[] {
  if (typeof v !== 'string' || !v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

async function readStdinIfPiped(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text || null;
}
