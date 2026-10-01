import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFrontmatterFile, skillFrontmatterSchema } from '@moxxy/sdk';
import { expect, it } from 'vitest';
import { computerTools } from './contract/tools.js';
import { createComputerControlPlugin } from './index.js';

const skill = parseFrontmatterFile(readFileSync(fileURLToPath(new URL('../skills/computer-control.md', import.meta.url)), 'utf8'));

it('allows exactly the tools the plugin can offer, on any platform', () => {
  const frontmatter = skillFrontmatterSchema.parse(skill.frontmatter);
  const offered = new Set([...Object.keys(computerTools), ...(createComputerControlPlugin('win32', 'x64').tools ?? []).map((tool) => tool.name)]);
  expect([...(frontmatter['allowed-tools'] ?? [])].sort()).toEqual([...offered].sort());
});

it('teaches the shared contract and no longer mentions the removed macOS tools', () => {
  expect(skill.body).toContain('computer_get_app_state');
  expect(skill.body).toContain('computer_request_access');
  expect(skill.body).not.toMatch(/computer_applescript|osascript|AppleScript/);
});
