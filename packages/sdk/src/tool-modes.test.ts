import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { defineTool } from './define.js';
import type { ToolRegistry } from './mode.js';
import { toolsForMode } from './tool-modes.js';

/**
 * A tool that only means something in one mode — goal mode's goal_abandon, a
 * collaboration's collab_inbox — was offered in every mode. In a plain browser
 * task the model called collab_inbox ("Not in a collaboration") and then
 * goal_abandon, and gave up on a task it could do. Such a tool names its modes,
 * and the others do not see it.
 */
const tool = (name: string, modes?: string[]) =>
  defineTool({ name, description: name, inputSchema: z.object({}), handler: async () => name, ...(modes ? { modes } : {}) });

const registry: ToolRegistry = {
  list: () => [tool('Read'), tool('goal_abandon', ['goal']), tool('collab_inbox', ['collab-architect', 'collab-peer'])],
  get: (name) => registry.list().find((t) => t.name === name),
  execute: async (name) => name,
};
const signal = new AbortController().signal;

describe('defineTool', () => {
  it('keeps the modes a tool is for', () => {
    expect(tool('goal_abandon', ['goal']).modes).toEqual(['goal']);
    expect(tool('Read')).not.toHaveProperty('modes');
  });
});

describe('toolsForMode', () => {
  it('leaves a tool meant for other modes out of the list and out of reach', async () => {
    const tools = toolsForMode(registry, 'default');

    expect(tools.list().map((t) => t.name)).toEqual(['Read']);
    expect(tools.get('goal_abandon')).toBeUndefined();
    await expect(tools.execute('Read', {}, signal)).resolves.toBe('Read');
    await expect(tools.execute('goal_abandon', {}, signal)).rejects.toThrow(/goal_abandon is not available in default mode/);
  });

  it('offers it in a mode it names', () => {
    expect(toolsForMode(registry, 'goal').list().map((t) => t.name)).toEqual(['Read', 'goal_abandon']);
    expect(toolsForMode(registry, 'collab-peer').get('collab_inbox')?.name).toBe('collab_inbox');
  });

  it('leaves a tool out of the modes it rules out, and offers it in every other', async () => {
    const asks = defineTool({
      name: 'ask_user',
      description: 'asks',
      inputSchema: z.object({}),
      handler: async () => 'asked',
      notInModes: ['goal'],
    });
    expect(asks.notInModes).toEqual(['goal']);
    const withAsk: ToolRegistry = { list: () => [tool('Read'), asks], get: (name) => withAsk.list().find((t) => t.name === name), execute: async (name) => name };

    expect(toolsForMode(withAsk, 'goal').list().map((t) => t.name)).toEqual(['Read']);
    expect(toolsForMode(withAsk, 'goal').get('ask_user')).toBeUndefined();
    await expect(toolsForMode(withAsk, 'goal').execute('ask_user', {}, signal)).rejects.toThrow(/ask_user is not available in goal mode/);
    expect(toolsForMode(withAsk, 'default').get('ask_user')?.name).toBe('ask_user');
  });
});
