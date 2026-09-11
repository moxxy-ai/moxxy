import { describe, expect, it } from 'vitest';
import { createComputerControlPlugin } from '../index.js';

describe('platform capability registration', () => {
  it('does not offer AppleScript or macOS shortcuts on Windows', () => {
    const plugin = createComputerControlPlugin('win32', 'x64');
    const tools = plugin.tools ?? [];
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('computer_observe');
    expect(names).toContain('computer_status');
    expect(names).not.toContain('computer_applescript');
    expect(names).not.toContain('computer_open');
    const key = tools.find((tool) => tool.name === 'computer_key');
    expect(key?.inputSchema.safeParse({ windowId: 'w', observationId: 'o', key: 'a', modifiers: ['cmd'] }).success).toBe(false);
    for (const tool of tools) expect(tool.permission?.action).toBe('prompt');
  });
  it('preserves existing Mac tool names and arguments', () => {
    const tools = createComputerControlPlugin('darwin', 'arm64').tools ?? [];
    expect(tools.map((tool) => tool.name)).toContain('computer_applescript');
    const click = tools.find((tool) => tool.name === 'computer_click');
    expect(click?.inputSchema.safeParse({ x: 12, y: 15 }).success).toBe(true);
  });
  it.each([['linux', 'x64'], ['win32', 'arm64']] as const)('only advertises status on unsupported %s/%s', (platform, arch) => {
    expect(createComputerControlPlugin(platform, arch).tools?.map((tool) => tool.name)).toEqual(['computer_status']);
  });
});
