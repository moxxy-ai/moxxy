import { defaultProjectSkillsDir, defaultUserSkillsDir, discoverSkills, silentLogger } from '@moxxy/core';
import { createMutex, writeFileAtomic } from '@moxxy/sdk';
import { BUILTIN_SKILLS_DIR_RESOLVED } from '../setup/builtin-skills-dir.js';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ParsedArgv } from '../argv.js';
import { confirmedYes, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy skills',
  tagline: 'manage skill files (.md frontmatter + body)',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'list discovered skills (project + user + built-in)'],
        ['new <name>', 'scaffold a new user-scope skill in ~/.moxxy/skills'],
        ['audit', 'inspect agent-created skills (revert | path)'],
      ],
    },
  ],
});

export interface AuditEntry {
  slug: string;
  ts: string;
  sessionId: string;
  originatingPrompt: string;
  scope: string;
}

const AUDIT_PATH = (): string => path.join(os.homedir(), '.moxxy', 'skills', '.meta', 'created.jsonl');

/**
 * Serializes whole-file read-modify-write rewrites of the audit log so two
 * overlapping `removeAuditEntry` cycles can't read the same snapshot and clobber
 * each other (invariant #5). The companion writer (`appendAudit` in
 * core skills/synthesize.ts) appends to the same file, so the rewrite must be
 * atomic too — see {@link removeAuditEntry}.
 */
const auditMutex = createMutex();

export async function runSkillsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'help' || helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  if (sub === 'list') {
    const skills = await discoverSkills({
      projectDir: defaultProjectSkillsDir(process.cwd()),
      userDir: defaultUserSkillsDir(),
      builtinDir: BUILTIN_SKILLS_DIR_RESOLVED,
      logger: silentLogger,
    });
    if (skills.length === 0) {
      process.stdout.write(colors.dim('(no skills discovered)') + '\n');
      return 0;
    }
    const nameCol = Math.max(8, ...skills.map((s) => s.frontmatter.name.length));
    const scopeCol = Math.max(7, ...skills.map((s) => s.scope.length));
    for (const s of skills) {
      const name = colors.bold(s.frontmatter.name.padEnd(nameCol));
      const scope = colors.dim(s.scope.padEnd(scopeCol));
      const desc = colors.dim(s.frontmatter.description);
      process.stdout.write(`${name}  ${scope}  ${desc}\n`);
    }
    return 0;
  }
  if (sub === 'new') {
    const name = argv.positional[1];
    if (!name) {
      printError('usage: moxxy skills new <name>');
      return 2;
    }
    const file = path.join(defaultUserSkillsDir(), `${name}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `---\nname: ${name}\ndescription: TODO\ntriggers: []\nallowed-tools: []\n---\n# ${name}\n\nTODO\n`,
    );
    process.stdout.write(`${colors.bold('created')}  ${colors.dim(file)}\n`);
    return 0;
  }
  if (sub === 'audit') {
    return await runAudit(argv);
  }
  printError(`unknown 'skills' subcommand: ${sub}\n${HELP}`);
  return 2;
}

async function runAudit(argv: ParsedArgv): Promise<number> {
  const action = argv.positional[1] ?? 'list';
  const entries = await readAuditLog();

  if (action === 'list') {
    if (entries.length === 0) {
      process.stdout.write(colors.dim('(no agent-created skills logged)') + '\n');
      return 0;
    }
    const groups = groupSimilarPrompts(entries);
    for (const group of groups) {
      const header = group.length === 1 ? '' : colors.dim(`  · ${group.length} similar`);
      process.stdout.write(`\n${colors.bold(truncate(group[0]!.originatingPrompt, 80))}${header}\n`);
      for (const e of group) {
        process.stdout.write(
          `  ${colors.dim(e.scope.padEnd(7))}  ${colors.bold(e.slug.padEnd(36))}  ${colors.dim(e.ts)}\n`,
        );
      }
    }
    return 0;
  }

  if (action === 'revert') {
    const slug = argv.positional[2];
    if (!slug) {
      printError('usage: moxxy skills audit revert <slug> [--yes]');
      return 2;
    }
    const match = entries.find((e) => e.slug === slug);
    if (!match) {
      printError(`no audit entry for slug: ${slug}`);
      return 1;
    }
    const baseDir = match.scope === 'user' ? defaultUserSkillsDir() : defaultProjectSkillsDir(process.cwd());
    const filePath = path.join(baseDir, `${match.slug}.md`);
    if (!confirmedYes(argv)) {
      printError(
        `refusing to revert without --yes. This will delete ${filePath} and drop the audit entry.\n` +
          `Re-run as: moxxy skills audit revert ${slug} --yes`,
      );
      return 2;
    }
    let removed = false;
    try {
      await fs.unlink(filePath);
      removed = true;
    } catch {
      // file already gone — still drop the audit entry
    }
    await removeAuditEntry(slug);
    process.stdout.write(
      removed ? `reverted ${slug} (${filePath})\n` : `audit entry removed; skill file was already gone\n`,
    );
    return 0;
  }

  if (action === 'path') {
    process.stdout.write(AUDIT_PATH() + '\n');
    return 0;
  }

  printError(`unknown 'skills audit' action: ${action}\n  list | revert <slug> | path`);
  return 2;
}

async function readAuditLog(): Promise<AuditEntry[]> {
  try {
    const text = await fs.readFile(AUDIT_PATH(), 'utf8');
    const entries: AuditEntry[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<AuditEntry>;
        if (parsed.slug && parsed.ts && parsed.originatingPrompt && parsed.scope) {
          entries.push({
            slug: parsed.slug,
            ts: parsed.ts,
            sessionId: parsed.sessionId ?? '',
            originatingPrompt: parsed.originatingPrompt,
            scope: parsed.scope,
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function removeAuditEntry(slug: string): Promise<void> {
  // Whole-file read-modify-write: serialize against concurrent removals (per-file
  // mutex) and rewrite atomically (writeFileAtomic) so a crash/kill mid-write can
  // never truncate the audit log to a partial JSONL line.
  await auditMutex.run(async () => {
    try {
      const text = await fs.readFile(AUDIT_PATH(), 'utf8');
      const kept = text
        .split('\n')
        .filter((line) => {
          if (!line.trim()) return false;
          try {
            const e = JSON.parse(line) as { slug?: string };
            return e.slug !== slug;
          } catch {
            return true;
          }
        })
        .join('\n');
      await writeFileAtomic(AUDIT_PATH(), kept + (kept ? '\n' : ''));
    } catch {
      // nothing to write back
    }
  });
}

export function groupSimilarPrompts(entries: ReadonlyArray<AuditEntry>): AuditEntry[][] {
  const groups: AuditEntry[][] = [];
  // Maintain a running union of each group's tokens so we never re-tokenize the
  // whole group on every entry (the previous `flatMap(tokenize)` rebuild was
  // O(n^2 * tokens)). The union is identical to rebuilding, so grouping is
  // unchanged.
  const groupTokenSets: Set<string>[] = [];
  for (const entry of entries) {
    const tokens = tokenize(entry.originatingPrompt);
    let placed = false;
    for (let i = 0; i < groups.length; i += 1) {
      const groupTokens = groupTokenSets[i]!;
      let overlap = 0;
      for (const t of tokens) if (groupTokens.has(t)) overlap += 1;
      if (overlap >= 2) {
        groups[i]!.push(entry);
        for (const t of tokens) groupTokens.add(t);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([entry]);
      groupTokenSets.push(new Set(tokens));
    }
  }
  return groups;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 3);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
