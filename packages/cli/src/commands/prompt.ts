import { collectTurn, createAllowListResolver, denyByDefaultResolver, runTurn } from '@moxxy/core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { setupSession } from '../setup.js';
import type { ParsedArgv } from '../argv.js';

export async function runPromptCommand(argv: ParsedArgv): Promise<number> {
  const prompt = String(argv.flags.p ?? argv.flags.prompt ?? '');
  if (!prompt) {
    process.stderr.write('error: -p/--prompt requires a non-empty string\n');
    return 2;
  }

  const stdinBuf = await readStdinIfPiped();
  const fullPrompt = stdinBuf ? `${prompt}\n\n${stdinBuf}` : prompt;

  const allowTools = parseList(argv.flags['allow-tools']);
  const allowAll = Boolean(argv.flags['allow-all']);
  const outputFormat = String(argv.flags['output-format'] ?? 'text') as 'text' | 'json' | 'stream-json';
  const model = argv.flags.model ? String(argv.flags.model) : undefined;

  const resolver = allowAll
    ? createAllowListResolver(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'synthesize_skill', 'reload_skills'])
    : allowTools.length > 0
      ? createAllowListResolver(allowTools)
      : denyByDefaultResolver;

  const session = await setupSession({
    cwd: process.cwd(),
    verbose: Boolean(argv.flags.verbose),
    resolver,
    model,
  });

  let exitCode = 0;
  try {
    if (outputFormat === 'text') {
      for await (const event of runTurn(session, fullPrompt, model ? { model } : {})) {
        if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
        if (event.type === 'tool_call_denied') {
          process.stderr.write(`\n[tool denied] ${event.reason}\n`);
          exitCode = 1;
        }
        if (event.type === 'error') {
          process.stderr.write(`\n[error] ${event.message}\n`);
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
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  return exitCode;
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
