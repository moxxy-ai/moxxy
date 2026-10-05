import { describe, expect, it } from 'vitest';
import { toolsForMode, type ToolRegistry } from '@moxxy/sdk';
import { COLLAB_ARCHITECT_MODE_NAME, COLLAB_PEER_MODE_NAME, collabTools } from './index.js';

/**
 * The collab_* tools only work for an agent inside a collaboration. Offered in
 * a plain browser task, the model opened collab_inbox ("Not in a
 * collaboration") before giving up. Only the team's agents see them.
 */
const registry: ToolRegistry = {
  list: () => collabTools,
  get: (name) => collabTools.find((tool) => tool.name === name),
  execute: async (name) => name,
};
const names = (mode: string) => toolsForMode(registry, mode).list().map((tool) => tool.name);

describe('collab tools', () => {
  it('are not offered outside a collaboration', () => {
    expect(names('default')).toEqual([]);
    expect(names('goal')).toEqual([]);
  });

  it('are offered to the architect and to every peer', () => {
    expect(names(COLLAB_ARCHITECT_MODE_NAME)).toHaveLength(collabTools.length);
    expect(names(COLLAB_PEER_MODE_NAME)).toHaveLength(collabTools.length);
  });
});
