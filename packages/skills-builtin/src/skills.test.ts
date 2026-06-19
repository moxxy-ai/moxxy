import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatterFile, skillFrontmatterSchema } from '@moxxy/sdk';
import { BUILTIN_SKILLS_DIR } from './index.js';

/**
 * The whole value of this package is the shipped `skills/` directory. The skill
 * loader (core) `safeParse`s each file and *silently drops* anything that fails
 * (`logger.warn` + `continue`) — so a malformed builtin ships green and only
 * manifests as a mysteriously-absent skill at runtime. These tests turn that
 * silent runtime drop into a CI failure: every shipped skill must parse, satisfy
 * the canonical frontmatter schema (name slug + <=240-char description), and
 * declare only slug-shaped `allowed-tools`.
 */

async function listSkillFiles(): Promise<string[]> {
  const entries = await fs.readdir(BUILTIN_SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(BUILTIN_SKILLS_DIR, e.name))
    .sort();
}

const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
// Margin the loader gives us before `description` (<=240) silently drops a skill.
// Keep some slack so a future copy edit can't blow the limit in one keystroke.
const MAX_DESCRIPTION = 240;
const DESCRIPTION_SAFETY_BUDGET = 230;

describe('shipped builtin skills', () => {
  it('finds at least one skill file', async () => {
    const files = await listSkillFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  it('every skill parses and validates against the frontmatter schema', async () => {
    const files = await listSkillFiles();
    const failures: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatterFile(raw);
      const parsed = skillFrontmatterSchema.safeParse(frontmatter);
      if (!parsed.success) {
        failures.push(`${path.basename(file)}: ${JSON.stringify(parsed.error.issues)}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every description stays within a safe margin of the 240-char cap', async () => {
    const files = await listSkillFiles();
    const tooLong: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatterFile(raw);
      const desc = frontmatter.description;
      // Hard cap is the schema's job (asserted above); this guards the margin so
      // a near-limit description can't silently flip to dropped on a small edit.
      if (typeof desc === 'string' && desc.length > DESCRIPTION_SAFETY_BUDGET) {
        tooLong.push(`${path.basename(file)} (${desc.length} > ${DESCRIPTION_SAFETY_BUDGET}; schema cap ${MAX_DESCRIPTION})`);
      }
    }
    expect(tooLong, tooLong.join('\n')).toEqual([]);
  });

  it('every allowed-tools entry is a slug-shaped tool name', async () => {
    const files = await listSkillFiles();
    const bad: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatterFile(raw);
      const tools = frontmatter['allowed-tools'];
      if (tools === undefined) continue;
      if (!Array.isArray(tools)) {
        bad.push(`${path.basename(file)}: allowed-tools is not an array`);
        continue;
      }
      for (const t of tools) {
        if (typeof t !== 'string' || !TOOL_NAME_RE.test(t)) {
          bad.push(`${path.basename(file)}: invalid tool name ${JSON.stringify(t)}`);
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('add-provider declares web_fetch and never references the non-existent WebFetch tool', async () => {
    const file = path.join(BUILTIN_SKILLS_DIR, 'add-provider.md');
    const raw = await fs.readFile(file, 'utf8');
    const { frontmatter, body } = parseFrontmatterFile(raw);
    const tools = (frontmatter['allowed-tools'] as unknown[]) ?? [];
    expect(tools).toContain('web_fetch');
    // The real tool is `web_fetch` (plugin-browser); `WebFetch` is not a
    // registered default tool — a body reference would stall onboarding.
    expect(body).not.toMatch(/\bWebFetch\b/);
  });
});
