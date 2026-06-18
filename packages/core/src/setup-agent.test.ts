import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definePlugin, defineProvider, defineTool, type LLMProvider } from '@moxxy/sdk';

import { setupAgent } from './setup-agent.js';

const tool = (name: string) =>
  defineTool({ name, description: name, inputSchema: z.object({}), handler: () => 'ok' });

const modePlugin = definePlugin({ name: 'mode-x', version: '0' });

const providerPlugin = (provName: string) =>
  definePlugin({
    name: `prov-${provName}`,
    version: '0',
    providers: [
      defineProvider({
        name: provName,
        models: [],
        createClient: () => ({}) as unknown as LLMProvider,
        validateKey: async () => ({ ok: true }),
      }),
    ],
  });

describe('setupAgent', () => {
  it('returns a destructurable Agent with the expected methods', () => {
    const { session, ask, stream, collect, discover, use, addTool, removeTool, setProvider, setMode } =
      setupAgent();
    for (const fn of [ask, stream, collect, discover, use, addTool, removeTool, setProvider, setMode]) {
      expect(typeof fn).toBe('function');
    }
    expect(session.cwd).toBeTruthy();
  });

  it('registers tools from options and supports hot add/remove', () => {
    const agent = setupAgent({ tools: [tool('a')] });
    expect(agent.session.tools.has('a')).toBe(true);
    agent.addTool(tool('b'));
    expect(agent.session.tools.has('b')).toBe(true);
    agent.removeTool('a');
    expect(agent.session.tools.has('a')).toBe(false);
  });

  it('merges an array of presets, de-duping a shared plugin (no double-register throw)', () => {
    // Both presets bring the same mode plugin → it must register once, not throw.
    expect(() =>
      setupAgent([{ plugins: [modePlugin] }, { plugins: [modePlugin], tools: [tool('t')] }]),
    ).not.toThrow();
  });

  it('activates the FIRST preset provider; the others stay registered to swap to', () => {
    const agent = setupAgent([
      { plugins: [providerPlugin('openai')], provider: { name: 'openai' } },
      { plugins: [providerPlugin('anthropic')], provider: { name: 'anthropic' } },
    ]);
    expect(agent.session.providers.getActiveName()).toBe('openai');
    expect(
      agent.session.providers
        .list()
        .map((d) => d.name)
        .sort(),
    ).toEqual(['anthropic', 'openai']);
    agent.setProvider('anthropic');
    expect(agent.session.providers.getActiveName()).toBe('anthropic');
  });

  it('hot-change methods are chainable (return the same agent)', () => {
    const agent = setupAgent();
    expect(agent.addTool(tool('x'))).toBe(agent);
  });
});
