import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asSkillId, mentionedSkills, parseFrontmatterFile, skillFrontmatterSchema } from '@moxxy/sdk';
import { expect, it } from 'vitest';
import { computerTools } from './contract/tools.js';

const skill = parseFrontmatterFile(readFileSync(fileURLToPath(new URL('../skills/computer-control.md', import.meta.url)), 'utf8'));

it('allows exactly the tools the plugin can offer, on any platform', () => {
  const frontmatter = skillFrontmatterSchema.parse(skill.frontmatter);
  expect([...(frontmatter['allowed-tools'] ?? [])].sort()).toEqual(Object.keys(computerTools).sort());
});

it('teaches the shared contract and no longer mentions removed tools', () => {
  expect(skill.body).toContain('computer_get_app_state');
  expect(skill.body).toContain('computer_request_access');
  expect(skill.body).not.toMatch(/computer_applescript|osascript|AppleScript/);
  expect(skill.body).not.toMatch(/computer_observe|computer_windows|computer_app_catalog|observationId|captureId/);
});

it('answers @computer_use in a chat prompt and keeps the in-window browser out of that request', () => {
  const frontmatter = skillFrontmatterSchema.parse(skill.frontmatter);
  const loaded = { id: asSkillId('plugin/computer-control'), path: 'computer-control.md', scope: 'plugin' as const, frontmatter, body: skill.body };

  expect(mentionedSkills('@computer_use zrób prezentację w Canvie w Arc', [loaded])).toEqual([loaded]);
  expect(frontmatter['disallowed-tools']).toEqual(['browser_*']);
  expect(frontmatter.label).toBe('Computer Use');
});
