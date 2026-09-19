import { describe, expect, it } from 'vitest';
import { createComputerControlPlugin } from '../index.js';

describe('platform capability registration', () => {
  it('accepts an explicit observation-required result without treating it as delivered input', () => {
    const tools = createComputerControlPlugin('win32', 'x64').tools ?? [];
    for (const name of ['computer_click', 'computer_type', 'computer_focus', 'computer_screenshot', 'computer_clipboard']) {
      const tool = tools.find(tool => tool.name === name);
      expect(tool).toBeDefined();
      const schema = tool?.outputSchema;
      expect(schema).toBeDefined();
      expect(schema?.safeParse({status:'needs_observation',delivered:false,effect:'possible',verificationRequired:true}).success).toBe(true);
      expect(schema?.safeParse({status:'needs_observation',delivered:true,effect:'possible',verificationRequired:true}).success).toBe(false);
    }
  });
  it('does not offer AppleScript or macOS shortcuts on Windows', () => {
    const plugin = createComputerControlPlugin('win32', 'x64');
    const tools = plugin.tools ?? [];
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('computer_observe');
    expect(names).toContain('computer_status');
    expect(names).not.toContain('computer_applescript');
    expect(names).toContain('computer_open');
    expect(names).toContain('computer_app_catalog');
    const open=tools.find(tool=>tool.name==='computer_open');
    expect(open?.inputSchema.safeParse({appId:'catalog-entry',instance:'new'}).success).toBe(true);
    expect(open?.inputSchema.safeParse({app:'cmd.exe',arguments:'/c anything'}).success).toBe(false);
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
