export interface ParsedArgv {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

/**
 * Flags that are value-less (boolean) everywhere in the CLI. Because the parser
 * is schema-less it would otherwise greedily bind the following positional as a
 * "value" (e.g. `moxxy --allow-all bash` → flags['allow-all']='bash', and `bash`
 * lost from positionals). Listing the well-known booleans keeps a trailing
 * command/positional intact. Value flags (`--model`, `--config`, `--allow-tools`,
 * `-p`, …) are deliberately absent so they still consume their argument.
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'help',
  'h',
  'version',
  'v',
  'yes',
  'y',
  'verbose',
  'allow-all',
  'standalone',
  'attach',
  'reload',
  'all',
  'stop',
  'status',
  'background',
]);

/**
 * Flags that ALWAYS take a value. For these the next token is consumed as the
 * value even when it begins with `-`, so a one-shot prompt or a model id/path
 * that legitimately starts with a dash isn't silently dropped
 * (`moxxy -p "-please summarize"`, `--model -o`). A value still stops at the
 * end of argv (a trailing value flag with nothing after it stays boolean).
 */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  'p',
  'prompt',
  'model',
  'config',
  'allow-tools',
  'output-format',
]);

/**
 * Decide a non-`=` flag's value. A known VALUE flag unconditionally consumes
 * the next token (even one starting with `-`); a known BOOLEAN flag never
 * consumes; an unknown flag keeps the legacy heuristic (consume the next token
 * only when it doesn't look like another flag). Returns the resolved value and
 * advances the caller's index via `advance` when a token is consumed.
 */
function consumeFlagValue(
  key: string,
  argv: ReadonlyArray<string>,
  i: number,
  advance: () => void,
): string | boolean {
  const next = argv[i + 1];
  if (next === undefined) return true;
  if (VALUE_FLAGS.has(key)) {
    advance();
    return next;
  }
  if (!next.startsWith('-') && !BOOLEAN_FLAGS.has(key)) {
    advance();
    return next;
  }
  return true;
}

export function parseArgv(argv: ReadonlyArray<string>): ParsedArgv {
  const result: ParsedArgv = { command: '', flags: {}, positional: [] };
  if (argv.length === 0) {
    result.command = 'tui';
    return result;
  }
  let i = 0;
  const first = argv[0]!;
  const looksLikeCommand = !first.startsWith('-');
  if (looksLikeCommand) {
    result.command = first;
    i = 1;
  }

  let endOfOptions = false;
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    if (endOfOptions) {
      result.positional.push(a);
      continue;
    }
    // `--` sentinel: everything after is taken verbatim as positionals, so a
    // value that looks like a flag (e.g. a prompt starting with `-`) survives.
    if (a === '--') {
      endOfOptions = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        result.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        result.flags[key] = consumeFlagValue(key, argv, i, () => i++);
      }
    } else if (a.startsWith('-')) {
      const key = a.slice(1);
      result.flags[key] = consumeFlagValue(key, argv, i, () => i++);
    } else {
      result.positional.push(a);
    }
  }

  if (!result.command) {
    if ('p' in result.flags || 'prompt' in result.flags) result.command = 'prompt';
    else if ('help' in result.flags || 'h' in result.flags) result.command = 'help';
    else if ('version' in result.flags || 'v' in result.flags) result.command = 'version';
    else result.command = 'tui';
  }
  return result;
}
