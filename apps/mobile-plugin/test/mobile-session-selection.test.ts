import { describe, expect, it } from 'vitest';

import { buildSelectedSessionRecord } from '../mobile/src/mobileSessionSelection';

describe('mobile selected session model', () => {
  it('marks the selected session read-only when there is no connected runtime snapshot for it', () => {
    expect(buildSelectedSessionRecord({
      connected: false,
      ownerWorkspaceId: 'desk-1',
      workspaceId: 'archived-session',
    })).toEqual({
      id: 'archived-session',
      live: false,
      readOnly: true,
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
