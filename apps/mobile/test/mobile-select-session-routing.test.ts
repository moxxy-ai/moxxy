import { describe, expect, it } from 'vitest';

import { routeSelectWorkspaceFrame } from '../src/gatewayFrameRouting';

describe('mobile session selection frame routing', () => {
  it('routes selected sessions through the global desk selector', () => {
    const selected: string[] = [];

    const handled = routeSelectWorkspaceFrame(
      { type: 'selectWorkspace', workspaceId: 'session-from-another-desk' },
      {
        setActiveSession: async (id) => {
          selected.push(id);
        },
      },
    );

    expect(handled).toBe(true);
    expect(selected).toEqual(['session-from-another-desk']);
  });

  it('ignores unrelated frames and empty selection ids', () => {
    const selected: string[] = [];
    const actions = {
      setActiveSession: async (id: string) => {
        selected.push(id);
      },
    };

    expect(routeSelectWorkspaceFrame({ type: 'runTurn', workspaceId: 'session-1' }, actions)).toBe(false);
    expect(routeSelectWorkspaceFrame({ type: 'selectWorkspace', workspaceId: '' }, actions)).toBe(true);
    expect(selected).toEqual([]);
  });
});
