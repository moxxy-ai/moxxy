import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MoxxyError, defineTool, z } from '@moxxy/sdk';
import { clampString, globToRegExp, IGNORED_DIR_NAMES, MAX_FILE_BYTES, resolvePath } from './util.js';

/**
 * Cap the model/user-supplied pattern length. A pathological catastrophic-
 * backtracking regex (`(a+)+$`, `(.*a){30}`) runs synchronously and pins the
 * event loop so abort/timeout listeners can never fire; a hard length ceiling
 * shrinks the space of such patterns. (See `YIELD_EVERY_LINES` below for the
 * other half: periodic event-loop yields so a watchdog can run.)
 */
const MAX_PATTERN_LEN = 1_000;

/**
 * Max directory depth walked. The walk recurses into real subdirectories; an
 * unbounded recursion over a pathologically deep tree (build artifacts,
 * fuzzers) would overflow the call stack with an uncatchable RangeError.
 */
const MAX_WALK_DEPTH = 100;

/**
 * Total lines scanned per call, across all files. The per-line `re.test` loop
 * runs synchronously; without a global ceiling a huge tree of large files keeps
 * the event loop busy long past any timeout. Bounds total regex work per call.
 */
const MAX_LINES_SCANNED = 5_000_000;

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
    return clampString(matches.join('\n'), 100_000);
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
      if (re.test(lines[i]!)) {
        matches.push(`${path.relative(root, full)}:${i + 1}:${lines[i]}`);
        if (matches.length >= max) return;
      }
    }
  }
}

