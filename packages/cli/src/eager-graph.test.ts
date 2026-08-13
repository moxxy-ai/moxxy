import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Modules that must never be reachable through a STATIC import from `bin.ts`.
 *
 * `moxxy --version` in a container used to evaluate the module graph of all 24
 * commands, and through the TUI channel the whole Ink runtime. A `--cpu-prof`
 * run confirmed `react/index.js` really did execute just to print a version
 * string. Commands are dispatched lazily now, so a command pays only for
 * itself, and the eager graph must stay that way.
 *
 * `@moxxy/plugin-cli` is the Ink TUI. Its `/logo-data` subpath is a pure data
 * module with no imports at all, which is why the boot art is allowed.
 */
const FORBIDDEN_EAGER = [
  { spec: '@moxxy/plugin-cli', reason: 'the Ink TUI; use the /logo-data subpath or import it lazily' },
  { spec: 'ink', reason: 'the TUI renderer' },
  { spec: 'react', reason: 'the TUI renderer' },
  { spec: './setup.js', reason: 'the whole session bootstrap; import it inside the command that needs it' },
] as const;

/** Static `import ... from '<spec>'` specifiers. Dynamic `import()` is
 *  deliberately NOT matched: deferring to it is the fix, not the problem. */
function staticImports(source: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]/gm;
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[1]!);
  // `export ... from '<spec>'` is an eager re-export too.
  const reExport = /^\s*export\s(?:[^'"]*?\sfrom\s)['"]([^'"]+)['"]/gm;
  for (let m = reExport.exec(source); m; m = reExport.exec(source)) out.push(m[1]!);
  return out;
}

/** Walk the eager graph from an entry, following only relative specifiers
 *  (a bare package is a leaf: we care THAT it is reached, not through what). */
async function eagerGraph(entry: string): Promise<Map<string, string[]>> {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    let source: string;
    try {
      source = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const specs = staticImports(source);
    seen.set(file, specs);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      // Sources are `.ts`; imports are written with the emitted `.js` suffix.
      const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
      queue.push(resolved);
    }
  }
  return seen;
}

describe('bin.ts eager import graph', () => {
  it('never statically reaches the TUI runtime or the session bootstrap', async () => {
    const graph = await eagerGraph(path.join(SRC, 'bin.ts'));
    const offenders: string[] = [];
    for (const [file, specs] of graph) {
      for (const { spec, reason } of FORBIDDEN_EAGER) {
        // Exact match only: `@moxxy/plugin-cli/logo-data` is a pure data leaf.
        if (!specs.includes(spec)) continue;
        offenders.push(`${path.relative(SRC, file)} imports "${spec}" (${reason})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Guards the guard: if the walk silently resolved nothing, the assertion
  // above would pass vacuously forever.
  it('actually walks a graph', async () => {
    const graph = await eagerGraph(path.join(SRC, 'bin.ts'));
    expect(graph.size).toBeGreaterThan(3);
    expect([...graph.keys()].some((f) => f.endsWith('argv.ts'))).toBe(true);
  });
});
