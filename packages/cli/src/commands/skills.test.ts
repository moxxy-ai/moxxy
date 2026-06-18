import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupSimilarPrompts, runSkillsCommand, tokenize, type AuditEntry } from './skills.js';
import type { ParsedArgv } from '../argv.js';

// `removeAuditEntry` is module-private; we exercise it through the public
// `moxxy skills audit revert <slug> --yes` path. AUDIT_PATH() reads os.homedir(),
// which is non-configurable, so we mock `node:os` to point homedir at a
// per-test throwaway dir and assert the on-disk audit log.

// A mutable holder so the hoisted vi.mock factory can read the per-test home
// without a temporal-dead-zone error (other modules call homedir() at import).
const homeRef = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeRef.dir || actual.homedir() };
});

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function auditPath(): string {
  return path.join(homeRef.dir, '.moxxy', 'skills', '.meta', 'created.jsonl');
}

function entry(slug: string): string {
  return JSON.stringify({
    slug,
    ts: '2026-01-01T00:00:00.000Z',
    sessionId: 's',
    originatingPrompt: `make ${slug}`,
    scope: 'user',
  });
}

function seedAudit(slugs: string[]): void {
  const file = auditPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, slugs.map(entry).join('\n') + '\n');
}

function revertArgv(slug: string): ParsedArgv {
  return { command: 'skills', flags: { yes: true }, positional: ['audit', 'revert', slug] };
}

function slugsOnDisk(): string[] {
  return readFileSync(auditPath(), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => (JSON.parse(l) as { slug: string }).slug);
}

beforeEach(() => {
  homeRef.dir = mkdtempSync(path.join(tmpdir(), 'mox-skills-'));
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

describe('removeAuditEntry (via skills audit revert)', () => {
  it('drops the matching slug and keeps all others (round-trip)', async () => {
    seedAudit(['alpha', 'beta', 'gamma']);
    const code = await runSkillsCommand(revertArgv('beta'));
    expect(code).toBe(0);
    expect(slugsOnDisk()).toEqual(['alpha', 'gamma']);
  });

  it('writes atomically — a failed rewrite leaves the original log intact', async () => {
    seedAudit(['alpha', 'beta']);
    const before = readFileSync(auditPath(), 'utf8');
    // writeFileAtomic writes a sibling temp then renames it over the target, so a
    // failure mid-rewrite (here: a full disk) never touches the original file.
    // Make the temp write fail by pointing the audit dir at a path that can't host
    // a temp sibling: replace the directory with a read-only one.
    const dir = path.dirname(auditPath());
    const chmod = (await import('node:fs')).chmodSync;
    chmod(dir, 0o500); // r-x: cannot create the .tmp sibling
    try {
      const code = await runSkillsCommand(revertArgv('beta'));
      expect(code).toBe(0); // failure is swallowed (best-effort)
    } finally {
      chmod(dir, 0o700);
    }
    expect(readFileSync(auditPath(), 'utf8')).toBe(before);
  });

  it('concurrent removals do not lose entries (serialized RMW)', async () => {
    seedAudit(['alpha', 'beta', 'gamma', 'delta']);
    // Fire overlapping reverts of distinct slugs. Without serialization, both
    // would read the same 4-entry snapshot and the second write would clobber
    // the first removal (lost update). The per-file mutex must prevent that.
    await Promise.all([
      runSkillsCommand(revertArgv('beta')),
      runSkillsCommand(revertArgv('delta')),
    ]);
    expect(slugsOnDisk().sort()).toEqual(['alpha', 'gamma']);
  });

  it('removing the last entry leaves an empty (parseable) log, not a dangling newline', async () => {
    seedAudit(['solo']);
    await runSkillsCommand(revertArgv('solo'));
    expect(existsSync(auditPath())).toBe(true);
    expect(readFileSync(auditPath(), 'utf8')).toBe('');
  });
});

describe('tokenize', () => {
  it('lowercases, splits on non-word chars, and drops tokens under 3 chars', () => {
    expect(tokenize('Build a CLI for X')).toEqual(['build', 'cli', 'for']);
    expect(tokenize('snake_case-and-dashes')).toEqual(['snake_case-and-dashes']);
    expect(tokenize('go ok no a')).toEqual([]); // all under 3 chars
  });
});

describe('groupSimilarPrompts', () => {
  function entryOf(slug: string, prompt: string): AuditEntry {
    return { slug, ts: '2026-01-01T00:00:00.000Z', sessionId: 's', originatingPrompt: prompt, scope: 'user' };
  }

  it('clusters prompts sharing >=2 tokens and isolates dissimilar ones', () => {
    const entries = [
      entryOf('a', 'generate a weekly sales report'),
      entryOf('b', 'generate a weekly sales summary'), // shares generate/weekly/sales → group a
      entryOf('c', 'convert images to webp format'), // shares nothing → own group
    ];
    const groups = groupSimilarPrompts(entries);
    expect(groups.map((g) => g.map((e) => e.slug))).toEqual([['a', 'b'], ['c']]);
  });

  it('requires at least two overlapping tokens (a single shared token is not enough)', () => {
    const entries = [
      entryOf('a', 'deploy the backend service'),
      entryOf('b', 'deploy nothing else matters here'), // shares only "deploy"
    ];
    const groups = groupSimilarPrompts(entries);
    expect(groups.map((g) => g.map((e) => e.slug))).toEqual([['a'], ['b']]);
  });

  it('places an entry in the FIRST matching group and grows that group token union', () => {
    const entries = [
      entryOf('a', 'parse json config files'),
      entryOf('b', 'render html report pages'),
      entryOf('c', 'parse json schema definitions'), // matches a (parse/json)
      entryOf('d', 'schema definitions for json parse'), // matches a's grown union too
    ];
    const groups = groupSimilarPrompts(entries);
    expect(groups.map((g) => g.map((e) => e.slug))).toEqual([['a', 'c', 'd'], ['b']]);
  });

  it('returns an empty array for no entries', () => {
    expect(groupSimilarPrompts([])).toEqual([]);
  });
});
