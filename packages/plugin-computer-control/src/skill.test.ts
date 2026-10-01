import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFrontmatterFile, skillFrontmatterSchema } from '@moxxy/sdk';
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
