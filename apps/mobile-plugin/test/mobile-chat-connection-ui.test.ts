import { describe, expect, it } from 'vitest';

import { buildChatConnectionUi } from '../mobile/src/chatConnectionUi';

describe('mobile chat connection UI model', () => {
  it('does not show a gateway reconnecting banner for a paired archived session', () => {
    expect(buildChatConnectionUi({
      gatewayConnected: true,
      selectedSessionConnected: false,
      selectedSessionReadOnly: true,
      sending: false,
    })).toEqual({
      bannerConnected: true,
      showConnectionBanner: false,
      statusLabel: 'Read-only',
    });
  });

  it('shows offline state when the gateway transport is not connected', () => {
    expect(buildChatConnectionUi({
      gatewayConnected: false,
      selectedSessionConnected: false,
      selectedSessionReadOnly: true,
      sending: false,
    })).toEqual({
      bannerConnected: false,
      showConnectionBanner: true,
      statusLabel: 'Offline',
    });
  });
});
