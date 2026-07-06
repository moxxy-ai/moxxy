#!/usr/bin/env node
/**
 * fixture-recorder — drives a single moxxy turn against the real Anthropic
 * API and writes the recorded ProviderEvents to a pretty-printed JSON fixture
 * (`<name>.<hash>.json`) the test harness can replay in CI.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... moxxy-record \
 *     --prompt "list files in cwd"  \
 *     --name list-files-demo        \
 *     --out packages/testing/__fixtures__ \
 *     --model claude-sonnet-4-6     \
 *     [--allow-tools Read,Glob]     \
 *     [--max-iterations 4]
 *
 * Notes:
 * - The recorder uses RecordedProvider in `record` mode so every Anthropic
 *   ProviderEvent is captured to the named fixture file.
 * - Subsequent test runs with MOXXY_FIXTURES=replay (the default) consume
 *   that fixture deterministically — zero tokens spent.
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Session,
  collectTurn,
  createAllowListResolver,
  createLogger,
  silentLogger,
} from '@moxxy/core';
import { AnthropicProvider, anthropicModels } from '@moxxy/plugin-provider-anthropic';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { defaultModePlugin } from '@moxxy/mode-default';
import { RecordedProvider } from '@moxxy/testing';
import type { LLMProvider } from '@moxxy/sdk';
import { assertDefined, definePlugin, defineProvider } from '@moxxy/sdk';

interface Flags {
  prompt: string;
  name: string;
  out: string;
  model?: string;
  allowTools: string[];
  maxIterations?: number;
  verbose: boolean;
}

const HELP = `moxxy-record — record an Anthropic turn into a pretty-printed JSON fixture

required:
  --prompt "..."      the user prompt to drive
  --name <id>         fixture base name (used in the filename)
  --out <dir>         directory to write fixtures into

optional:
  --model <model-id>            override default model
  --allow-tools <a,b,c>         comma-separated tool whitelist
  --max-iterations <n>          cap the loop
  --verbose                     debug logging
  --help                        this help

env:
  ANTHROPIC_API_KEY             required for the recorder
`;

export interface RecordOptions {
  /**
   * Upstream provider the recorder wraps. Defaults to the real (paid) Anthropic
   * provider; injectable so a deterministic fake can drive a full record() with
   * no network — exercises the orchestration without spending tokens.
   */
  readonly upstream?: LLMProvider;
}

export async function record(
  flags: Flags,
  opts: RecordOptions = {},
): Promise<{ fixtureFiles: string[]; events: number }> {
  const out = path.resolve(flags.out);

  // Fail fast on an unknown model before constructing a billable Session: a typo
  // (`--model claude-sonet-4-6`) would otherwise only be rejected by Anthropic
  // after a network round-trip, having already started a paid session.
  if (flags.model !== undefined && !anthropicModels.some((m) => m.id === flags.model)) {
    throw new Error(
      `unknown model: ${flags.model} (known: ${anthropicModels.map((m) => m.id).join(', ')})`,
    );
  }

  // Recorded fixtures embed verbatim request/response content (system + user
  // prompt, tool schemas, and any cwd content tools read) and are intended to be
  // committed — do not record against secrets.
  process.stderr.write(
    'warning: fixtures embed verbatim request/response content (prompt, tool schemas, ' +
      'and any cwd files allowed tools read); do not record against secrets — they are ' +
      'persisted into the committed fixture.\n',
  );

  const upstream = opts.upstream ?? new AnthropicProvider({});
  const recorder = new RecordedProvider({
    mode: 'record',
    upstream,
    fixtureDir: out,
    testName: flags.name,
  });

  const logger = flags.verbose ? createLogger({ minLevel: 'debug' }) : silentLogger;
  const session = new Session({
    cwd: process.cwd(),
    logger,
    permissionResolver: createAllowListResolver(flags.allowTools),
  });

  // Provider shim that returns our recording wrapper rather than a fresh client.
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'recorder-provider-shim',
      providers: [
        defineProvider({
          name: 'anthropic-recording',
          models: [...anthropicModels],
          createClient: () => recorder,
        }),
      ],
    }),
  );
  session.providers.setActive('anthropic-recording');
  session.pluginHost.registerStatic(builtinToolsPlugin);
  session.pluginHost.registerStatic(defaultModePlugin);

  // Ctrl-C / SIGTERM mid-record aborts the in-flight upstream stream cleanly
  // instead of relying on a hard process kill that abandons the open paid HTTP
  // stream. Handlers are removed in finally so record() leaks no listeners.
  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let events: ReadonlyArray<unknown>;
  try {
    events = await collectTurn(session, flags.prompt, {
      model: flags.model,
      signal: ac.signal,
      ...(flags.maxIterations ? { maxIterations: flags.maxIterations } : {}),
    });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    // Run plugin onShutdown hooks so any timers/handles the builtin tools or
    // mode opened are released — otherwise they leak (across a test suite, or
    // until the CLI process exits).
    await session.close().catch(() => {});
  }

  // The recorder itself tracks the EXACT absolute paths it wrote this run, so we
  // report those directly rather than diffing a directory listing. A directory
  // mtime-diff is fragile under coarse FS mtime resolution (a fixture rewritten
  // in the same clock tick reads as "unchanged" and is silently dropped from the
  // report) and under clock skew; the recorder's set has neither failure mode and
  // can never include a stale fixture orphaned by a prior --name-sharing run.
  const fixtureFiles = [...recorder.writtenFixtures].sort();
  return { fixtureFiles, events: events.length };
}

export function parseFlags(argv: ReadonlyArray<string>): Flags | { help: true } {
  if (argv.length === 0) return { help: true };
  const flags: Partial<Flags> & { allowTools?: string[]; verbose?: boolean } = {
    allowTools: [],
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    assertDefined(a, 'loop index is within the bounds of argv');
    // Consume the value following a value-bearing flag, rejecting a missing or
    // flag-shaped token so a typo (`--prompt --name x`) yields a clear
    // "requires a value" error instead of swallowing the next flag.
    const takeValue = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`${a} requires a value`);
      }
      i += 1;
      return next;
    };
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--verbose') flags.verbose = true;
    else if (a === '--prompt') flags.prompt = takeValue();
    else if (a === '--name') flags.name = takeValue();
    else if (a === '--out') flags.out = takeValue();
    else if (a === '--model') flags.model = takeValue();
    else if (a === '--max-iterations') {
      // Validate up-front: a malformed `--max-iterations abc` would otherwise
      // become NaN and be silently dropped at the call site's truthiness guard,
      // letting the recorder run unbounded against the real paid Anthropic API.
      const raw = takeValue();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error('--max-iterations must be a positive integer');
      }
      flags.maxIterations = n;
    }
    else if (a === '--allow-tools') flags.allowTools = takeValue().split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown flag: ${a}`);
  }
  if (!flags.prompt) throw new Error('--prompt is required');
  if (!flags.name) throw new Error('--name is required');
  if (!flags.out) throw new Error('--out is required');
  return {
    prompt: flags.prompt,
    name: flags.name,
    out: flags.out,
    model: flags.model,
    allowTools: flags.allowTools ?? [],
    maxIterations: flags.maxIterations,
    verbose: flags.verbose ?? false,
  };
}

async function main(): Promise<number> {
  let parsed: Flags | { help: true };
  try {
    parsed = parseFlags(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    return 2;
  }
  if ('help' in parsed) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('ANTHROPIC_API_KEY is required\n');
    return 1;
  }
  const result = await record(parsed);
  process.stdout.write(
    `recorded ${result.events} events; fixtures:\n${result.fixtureFiles.map((f) => `  ${f}`).join('\n')}\n`,
  );
  return 0;
}

// Compare percent-encoded file URLs: a hand-built `file://${argv[1]}` is NOT
// encoded, so an install path with a space/reserved char (common on macOS) made
// this false and `main()` silently never ran. pathToFileURL matches Node's own
// `import.meta.url` encoding.
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
