import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MoxxyError, defineTool, z } from '@moxxy/sdk';
import {
  clampString,
  globToRegExp,
  IGNORED_DIR_NAMES,
  MAX_FILE_BYTES,
  MAX_WALK_DEPTH,
  resolvePath,
} from './util.js';

/**
 * Cap the model/user-supplied pattern length. A pathological catastrophic-
 * backtracking regex (`(a+)+$`, `(.*a){30}`) runs synchronously and pins the
 * event loop so abort/timeout listeners can never fire; a hard length ceiling
 * shrinks the space of such patterns. (See `YIELD_EVERY_LINES` below for the
 * other half: periodic event-loop yields so a watchdog can run.)
 */
const MAX_PATTERN_LEN = 1_000;

/**
 * Total lines scanned per call, across all files. The per-line `re.test` loop
 * runs synchronously; without a global ceiling a huge tree of large files keeps
 * the event loop busy long past any timeout. Bounds total regex work per call.
 */
const MAX_LINES_SCANNED = 5_000_000;

/**
 * Max chars of any single line handed to `re.test`. The per-line yield only
 * helps *between* lines — a file with no newline (a minified bundle, a one-line
 * blob, an adversarial 10 MB line) is a single array element, so `re.test` runs
 * exactly once with no yield opportunity. Catastrophic-backtracking cost scales
 * with input length, so a pattern like `(.*a){30}` (well under MAX_PATTERN_LEN)
 * against a 10 MB line still pins the event loop indefinitely. Truncate the line
 * to a bound before testing: grep is a line-oriented prefix search, so a match
 * in the first 64 KB is still reported; matches only past that on a single
 * monster line are rare and not worth a DoS window. The dropped tail is still
 * charged to the global scan budget so total work stays bounded.
 */
const MAX_LINE_LEN = 64 * 1024;

/**
 * Conservative ReDoS structural linter. A per-line length cap (`MAX_LINE_LEN`)
 * and the per-line event-loop yield bound *polynomial* backtracking, but they
 * cannot defeat *exponential* backtracking: a single synchronous `re.test()`
 * call can't be interrupted, and exponential patterns (`(a+)+$`, `(.*a)+b`,
 * `(a|a)*`) blow up even on ~100 chars — measured at 60+ s. With the `inproc`
 * isolator (the default; off-by-default plugin-security) there is no other
 * watchdog, so the only real defense is to refuse the dangerous shape up front.
 *
 * The classic exponential shape is a quantifier (`*`, `+`, `{n,}`) applied to a
 * group whose body itself contains an unbounded quantifier or a top-level
 * alternation of overlapping branches. We flag that conservatively: a `)`
 * immediately followed by an unbounded quantifier, where the just-closed group
 * contained an unbounded quantifier or a `|`. This catches the dominant
 * nested-quantifier families with very low false-positive risk on real search
 * patterns (a literal like `foo.*bar` or `\bword\b` never trips it). A flagged
 * pattern is refused with an actionable message rather than run.
 */
function isLikelyReDoS(pattern: string): boolean {
  // Scan for a group `( ... )Q` where Q is an unbounded quantifier and the
  // group body contains an inner unbounded quantifier or a top-level `|`.
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== '(') continue;
    // Find the matching close paren, tracking nesting and skipping escapes /
    // char classes (a `(` or `)` inside `[...]` or after `\` is a literal).
    let depth = 0;
    let inClass = false;
    let close = -1;
    let body = '';
    for (let j = i; j < pattern.length; j += 1) {
      const c = pattern[j]!;
      if (c === '\\') {
        j += 1; // skip the escaped char
        continue;
      }
      if (inClass) {
        if (c === ']') inClass = false;
        continue;
      }
      if (c === '[') {
        inClass = true;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
      if (depth >= 1 && j > i) body += c;
    }
    if (close === -1) continue; // unbalanced — RegExp ctor will reject it
    // Is the group immediately quantified by an unbounded quantifier?
    const after = pattern.slice(close + 1);
    const quantified = /^(?:[*+]|\{\d+,\}|\{\d{2,}\})/.test(after) || /^\{[1-9]\d+,?\d*\}/.test(after);
    if (!quantified) continue;
    // Does the body itself carry unbounded repetition or a top-level alternation?
    const innerUnbounded = /[*+]|\{\d+,\}|\{\d{2,}\}/.test(body);
    const hasAlternation = body.includes('|');
    if (innerUnbounded || hasAlternation) return true;
  }
  return false;
}

/** Treat a file as binary (and skip it) if its leading bytes contain a NUL —
 *  the same cheap heuristic ripgrep/grep use to avoid scanning binary garbage. */
function looksBinary(content: string): boolean {
  // A real text file never contains U+0000; reading binary as utf8 yields NULs
  // for the raw zero bytes. Check only a bounded prefix so this stays cheap.
  const limit = Math.min(content.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (content.charCodeAt(i) === 0) return true;
  }
  return false;
}

export const grepTool = defineTool({
  name: 'Grep',
  description: 'Recursively search files for a regex pattern. Returns lines as `path:line:text`.',
  inputSchema: z.object({
    pattern: z.string().min(1),
    cwd: z.string().optional(),
    glob: z.string().optional().describe('Optional file-name glob filter (e.g. "*.ts").'),
    caseInsensitive: z.boolean().optional().default(false),
    maxMatches: z.number().int().positive().max(10_000).optional().default(500),
  }),
  permission: { action: 'prompt' },
  compact: {
    verb: 'Searching for',
    noun: { one: 'pattern', other: 'patterns' },
    previewKey: 'pattern',
  },
  isolation: {
    capabilities: {
      fs: { read: ['$cwd/**'] },
      net: { mode: 'none' },
      timeMs: 60_000,
    },
  },
  async handler({ pattern, cwd, glob, caseInsensitive, maxMatches }, ctx) {
    const baseDir = resolvePath(ctx.cwd, cwd ?? '.');
    if (pattern.length > MAX_PATTERN_LEN) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: `Grep: pattern too long (${pattern.length} > ${MAX_PATTERN_LEN} chars).`,
      });
    }
    // Refuse exponential-backtracking shapes before compiling. A synchronous
    // `re.test()` can't be interrupted by the abort/timeout watchdog, so this
    // is the only real defense against a catastrophic-backtracking DoS in the
    // default inproc configuration.
    if (isLikelyReDoS(pattern)) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message:
          `Grep: pattern ${JSON.stringify(pattern)} has a nested-quantifier shape that risks ` +
          `catastrophic backtracking (denial of service) and was refused. Rewrite it without a ` +
          `quantifier applied to a group that itself repeats or alternates (e.g. avoid \`(a+)+\`, \`(.*x)+\`, \`(a|a)*\`).`,
      });
    }
    let re: RegExp;
    try {
      re = new RegExp(pattern, caseInsensitive ? 'i' : '');
    } catch (e) {
      // A malformed user pattern would otherwise throw a raw SyntaxError;
      // surface it as a clean, actionable tool error instead.
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: `Grep: invalid regular expression ${JSON.stringify(pattern)}: ${(e as Error).message}`,
      });
    }
    const fileRe = glob ? globToRegExp(glob) : null;
    const matches: string[] = [];
    // Shared scan budget: bounds total regex work per call across every file so
    // a deep tree of large files can't pin the event loop indefinitely.
    const budget = { lines: MAX_LINES_SCANNED };
    await walk(baseDir, baseDir, re, fileRe, matches, maxMatches, ctx.signal, 0, budget);
    const body = clampString(matches.join('\n'), 100_000);
    // Tell the model when the result is partial so it doesn't conclude "no more
    // matches exist." Hitting the match cap or exhausting the scan budget both
    // mean there may be further matches we never reached.
    if (matches.length >= maxMatches) {
      return `${body}${body ? '\n' : ''}[truncated — reached the ${maxMatches}-match cap; narrow the pattern/glob or raise maxMatches to see more]`;
    }
    if (budget.lines <= 0) {
      return `${body}${body ? '\n' : ''}[truncated — scan budget exhausted before the whole tree was searched; narrow with a glob or a more specific cwd]`;
    }
    return body;
  },
});

/** Yield to the event loop after this many lines so abort/timeout listeners
 *  (which can't run while a synchronous loop owns the thread) get a turn. */
const YIELD_EVERY_LINES = 50_000;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function walk(
  root: string,
  cursor: string,
  re: RegExp,
  fileRe: RegExp | null,
  matches: string[],
  max: number,
  signal: AbortSignal,
  depth: number,
  budget: { lines: number },
): Promise<void> {
  if (signal.aborted || matches.length >= max || budget.lines <= 0) return;
  // Bound recursion depth: a pathologically deep real tree would otherwise
  // overflow the call stack with an uncatchable RangeError.
  if (depth >= MAX_WALK_DEPTH) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(cursor, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal.aborted || matches.length >= max || budget.lines <= 0) return;
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(cursor, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, re, fileRe, matches, max, signal, depth + 1, budget);
      continue;
    }
    if (!entry.isFile()) continue;
    if (fileRe && !fileRe.test(entry.name)) continue;
    // Skip oversized files before reading so a giant log / db / media blob can't
    // be slurped into the heap. Bounds the per-file working set (result clamping
    // only bounds the OUTPUT).
    try {
      const st = await fs.stat(full);
      if (st.size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }
    let content: string;
    try {
      content = await fs.readFile(full, 'utf8');
    } catch {
      continue;
    }
    // Skip binaries (NUL byte in the prefix) — scanning binary-as-utf8 yields
    // useless matches and mojibake. Normal text files are unaffected, so match
    // output for them is byte-identical to before.
    if (looksBinary(content)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Periodically yield so a synchronous catastrophic-backtracking pattern
      // can't pin the event loop past the abort/timeout watchdog. Also enforce
      // the global per-call line budget.
      if (i > 0 && i % YIELD_EVERY_LINES === 0) {
        await tick();
        if (signal.aborted) return;
      }
      if (budget.lines <= 0) return;
      budget.lines -= 1;
      const raw = lines[i]!;
      // Cap the length of the line actually handed to the regex engine: a
      // single monster line is the one input the per-line yield can't protect,
      // and backtracking blowup scales with input length. Charge the dropped
      // tail to the global budget too so a few huge lines still exhaust it.
      const line = raw.length > MAX_LINE_LEN ? raw.slice(0, MAX_LINE_LEN) : raw;
      if (raw.length > MAX_LINE_LEN) {
        budget.lines -= Math.ceil((raw.length - MAX_LINE_LEN) / MAX_LINE_LEN);
      }
      if (re.test(line)) {
        matches.push(`${path.relative(root, full)}:${i + 1}:${line}`);
        if (matches.length >= max) return;
      }
    }
  }
}

