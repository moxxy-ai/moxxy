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

describe('the self-heal skill', () => {
  const read = async () => parseFrontmatterFile(await fs.readFile(path.join(BUILTIN_SKILLS_DIR, 'self-heal.md'), 'utf8'));

  // The description is in every request's skill index. When it covered any
  // failed tool call, the agent answered an ordinary error in the task with a
  // proposal and a wait for approval instead of trying another way.
  it('is for Moxxy itself being broken, not for an ordinary error in the task', async () => {
    const frontmatter = skillFrontmatterSchema.parse((await read()).frontmatter);

    expect(frontmatter.description).toMatch(/^When Moxxy itself is broken/);
    expect(frontmatter.description).toMatch(/Not for ordinary task errors; work through those yourself\.$/);
    expect(frontmatter.description).not.toMatch(/When a tool call fails/);
  });

  it('is not triggered by the words of an everyday failure', async () => {
    const frontmatter = skillFrontmatterSchema.parse((await read()).frontmatter);
    const everyday = ['tool failed', 'permission denied', 'not found', "doesn't work", 'broken', 'fix this', 'fix it', "can't run", 'is hanging', 'is stuck', 'is failing', "what's wrong", 'diagnose', 'repair'];

    expect((frontmatter.triggers ?? []).filter((trigger) => everyday.includes(trigger))).toEqual([]);
    expect(frontmatter.triggers).toContain('self-heal');
    expect(frontmatter.triggers).toContain('plugin failed to load');
  });

  it('says in its body when it applies and that task errors are worked through', async () => {
    const { body } = await read();

    expect(body).toMatch(/## When this applies/);
    expect(body).toMatch(/Only when \*\*Moxxy itself\*\* is at fault/);
    expect(body).toMatch(/try\s+another way and carry on, without asking the user to approve each step/);
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

  it('produces requested screenshots by reading rather than clicking their target', async () => {
    const text = await body();
    expect(text).toMatch(/For a requested picture, use `browser_capture`/);
    expect(text).toMatch(/never click to select an element for its picture/);
  });

  it('restores the actual viewport through reset rather than an assumed desktop size', async () => {
    expect(await body()).toContain('restore normal size with `reset: true`');
  });

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

  it('lets it decline a cookie banner itself, and never accept one', async () => {
    const text = await body();
    expect(text).toMatch(/is the one you answer\s+yourself/);
    expect(text).toMatch(/under \*\*Cookie banner\*\*; press it\s+and carry on, without asking/);
    expect(text).toMatch(/Never press a control that accepts or agrees/);
    expect(text).toMatch(/hand over a banner that shows no way to decline/);
  });

  it('tells it to stop, not work around, when the user takes the browser', async () => {
    const text = await body();
    expect(text).toMatch(/taken over the browser/);
    expect(text).toMatch(/Do not retry, and do not reach the page another way/);
  });

  it('carries a task to its end instead of handing the next click to the user', async () => {
    const text = await body();
    expect(text).toMatch(/Finish the task yourself/);
    expect(text).toMatch(/never ask the\s+user to click/i);
  });

  it('does what a page says is still needed, by the control that does it under its own name', async () => {
    // A page said "Please redeploy to apply the new configuration." and offered
    // only Restart; the agent looked for a Redeploy button, found none, and
    // handed a change it had made back to the user, unapplied.
    const text = await body();
    expect(text).toMatch(/A change the page says is not applied yet is not done/);
    expect(text).toMatch(/the control that does it under another name/);
    expect(text).toMatch(/only to what you\s+set up or changed in this task/);
  });

  it('looks at the closest matches before deciding a control is not there', async () => {
    const text = await body();
    expect(text).toMatch(/names the closest/);
    expect(text).toMatch(/before you decide it is not there/);
  });

  it('answers a question about a list from the whole list', async () => {
    const text = await body();
    expect(text).toMatch(/every item/);
  });

  it('treats allowing a site as a step it takes, not a reason to stop', async () => {
    // In a fresh conversation no site was allowed yet; the agent read "ask" as
    // "I have no permission" and gave the task up instead of calling the tool.
    const text = await body();
    expect(text).toMatch(/`browser_allow_site` is how you ask/);
    expect(text).toMatch(/never a\s+reason to stop/);
  });

  it('teaches the picture tools for what has no name', async () => {
    const text = await body();
    expect(text).toMatch(/browser_point/);
    expect(text).toMatch(/newest one/);
  });
});
