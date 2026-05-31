import { describe, expect, it } from 'vitest';
import { buildInstallPluginTool, buildUninstallPluginTool } from './install.js';

const noopDeps = {
  reload: async (): Promise<void> => undefined,
  snapshot: () => ({
    tools: [],
    agents: [],
    providers: [],
    modes: [],
    compactors: [],
    channels: [],
  }),
};

describe('install_plugin tool', () => {

  it('validates package name format', async () => {
    const tool = buildInstallPluginTool(noopDeps);
    const result = tool.inputSchema.safeParse({ packageName: 'NOT VALID NAME' });
    expect(result.success).toBe(false);
  });

  it('accepts a scoped package', () => {
    const tool = buildInstallPluginTool(noopDeps);
    const result = tool.inputSchema.safeParse({ packageName: '@moxxy/agent-researcher' });
    expect(result.success).toBe(true);
  });

  it('accepts an optional version', () => {
    const tool = buildInstallPluginTool(noopDeps);
    const result = tool.inputSchema.safeParse({
      packageName: '@moxxy/agent-researcher',
      version: '1.2.3',
    });
    expect(result.success).toBe(true);
  });
});

describe('uninstall_plugin tool', () => {
  it('is named uninstall_plugin and gated', () => {
    const tool = buildUninstallPluginTool(noopDeps);
    expect(tool.name).toBe('uninstall_plugin');
    expect(tool.permission).toEqual({ action: 'prompt' });
  });

  it('validates package name format', () => {
    const tool = buildUninstallPluginTool(noopDeps);
    expect(tool.inputSchema.safeParse({ packageName: 'NOT VALID NAME' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ packageName: '@moxxy/agent-researcher' }).success).toBe(true);
  });
});
