import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MoxxyError, defineTool, z } from '@moxxy/sdk';
import { clampString, globToRegExp, IGNORED_DIR_NAMES, resolvePath } from './util.js';

/**
 * Skip files larger than this — a multi-hundred-MB log, a SQLite db, or a media
 * blob would otherwise be slurped fully into the heap and split into a giant
 * line array on a path the model invokes constantly. Result clamping bounds the
 * OUTPUT, not the per-file working set; this bounds the working set.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
    await walk(baseDir, baseDir, re, fileRe, matches, maxMatches, ctx.signal);
    return clampString(matches.join('\n'), 100_000);
  },
});

async function walk(
  root: string,
  cursor: string,
  re: RegExp,
  fileRe: RegExp | null,
  matches: string[],
  max: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || matches.length >= max) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(cursor, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal.aborted || matches.length >= max) return;
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(cursor, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, re, fileRe, matches, max, signal);
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
      if (re.test(lines[i]!)) {
        matches.push(`${path.relative(root, full)}:${i + 1}:${lines[i]}`);
        if (matches.length >= max) return;
      }
    }
  }
}

