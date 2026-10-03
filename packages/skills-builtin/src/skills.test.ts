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

  it('no shipped skill body references the non-existent WebFetch tool (the original drift)', async () => {
    const files = await listSkillFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { body } = parseFrontmatterFile(raw);
      if (/\bWebFetch\b/.test(body)) offenders.push(path.basename(file));
    }
    expect(offenders, `bodies must use \`web_fetch\`, not \`WebFetch\`: ${offenders.join(', ')}`).toEqual([]);
  });

  it('frontmatter name matches the filename slug', async () => {
    const files = await listSkillFiles();
    const mismatched: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatterFile(raw);
      const slug = path.basename(file, '.md');
      if (frontmatter.name !== slug) {
        mismatched.push(`${path.basename(file)} declares name="${String(frontmatter.name)}"`);
      }
    }
    // A name/filename mismatch is confusing at best and, if the name collides
    // with another skill, lets one silently shadow the other in the registry.
    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('skill names are unique', async () => {
    const files = await listSkillFiles();
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatterFile(raw);
      const name = String(frontmatter.name);
      const prev = seen.get(name);
      if (prev) dupes.push(`${name}: ${prev} & ${path.basename(file)}`);
      else seen.set(name, path.basename(file));
    }
    expect(dupes, dupes.join('\n')).toEqual([]);
  });

  it('allowed-tools arrays have no empty or duplicate entries', async () => {
    const files = await listSkillFiles();
    const bad: string[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const { frontmatter } = parseFrontmatterFile(raw);
      const tools = frontmatter['allowed-tools'];
      if (!Array.isArray(tools)) continue;
      const strs = tools.filter((t): t is string => typeof t === 'string');
      if (strs.some((t) => t.trim() === '')) bad.push(`${path.basename(file)}: empty allowed-tools entry`);
      if (new Set(strs).size !== strs.length) bad.push(`${path.basename(file)}: duplicate allowed-tools entry`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('the browser skill in the chat @ menu', () => {
  it('shows as the Moxxy Browser, answers @moxxy_browser and keeps Computer Use out of that request', async () => {
    const raw = await fs.readFile(path.join(BUILTIN_SKILLS_DIR, 'browser.md'), 'utf8');
    const frontmatter = skillFrontmatterSchema.parse(parseFrontmatterFile(raw).frontmatter);

    expect(frontmatter.label).toBe('Moxxy Browser');
    expect(frontmatter.aliases?.[0]).toBe('moxxy_browser');
    expect(frontmatter['disallowed-tools']).toEqual(['computer_*']);
  });
});

describe('the browser skill', () => {
  const body = async () => parseFrontmatterFile(await fs.readFile(path.join(BUILTIN_SKILLS_DIR, 'browser.md'), 'utf8')).body;

  it('offers runs of steps only where they exist, and says to carry on from the page they return', async () => {
    const text = await body();
    expect(text).toMatch(/When `browser_run` is among your tools/);
    expect(text).toMatch(/When `browser_run` is not among your tools, do\s+not look for it/);
    expect(text).toMatch(/do not read it again/);
  });

  it('keeps the agent from the slow habits the trials showed: guessing URLs again, reopening the page, looking twice', async () => {
    const text = await body();
    expect(text).toMatch(/guess once/);
    expect(text).toMatch(/Never open the page you are already on/);
    expect(text).toMatch(/Trust one clear signal/);
  });

  it('tells it to stop, not work around, when the user takes the browser', async () => {
    const text = await body();
    expect(text).toMatch(/taken over the browser/);
    expect(text).toMatch(/Do not retry, and do not reach the page another way/);
  });

  it('teaches the picture tools for what has no name', async () => {
    const text = await body();
    expect(text).toMatch(/browser_point/);
    expect(text).toMatch(/newest one/);
  });
});
