import { describe, expect, it } from 'vitest';

import { buildSelectedSessionRecord } from '../src/mobileSessionSelection';

describe('mobile selected session model', () => {
  it('keeps the selected session writable even when it was not the original live runtime', () => {
    expect(buildSelectedSessionRecord({
      connected: false,
      ownerWorkspaceId: 'desk-1',
      workspaceId: 'archived-session',
    })).toEqual({
      id: 'archived-session',
      live: false,
      readOnly: false,
      workspaceId: 'desk-1',
    });
  });

  it('keeps the live selected session writable when its runtime is connected', () => {
    expect(buildSelectedSessionRecord({
      connected: true,
      ownerWorkspaceId: 'desk-1',
      workspaceId: 'live-session',
    })).toEqual({
      id: 'live-session',
      live: true,
      readOnly: false,
      workspaceId: 'desk-1',
    });
  });
});
