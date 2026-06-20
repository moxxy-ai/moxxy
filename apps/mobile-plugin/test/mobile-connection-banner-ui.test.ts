import { describe, expect, it } from 'vitest';

import { buildConnectionBannerUi } from '../mobile/src/connectionBannerUi';

describe('mobile connection banner UI model', () => {
  it('explains how to enable the desktop gateway when the device is not paired', () => {
    expect(buildConnectionBannerUi({ paired: false, status: 'closed' })).toEqual({
      actionLabel: 'Open settings',
      icon: 'wifiOff',
      title: 'Enable Moxxy Mobile on your desktop',
      body: 'Open Moxxy Desktop, go to Settings -> Mobile, then turn on Enable mobile gateway and pair this phone.',
      steps: [
        'Open Moxxy Desktop on your Mac.',
        'Go to Settings -> Mobile.',
        'Turn on Enable mobile gateway.',
        'Return here and pair this phone.',
      ],
    });
  });

  it('shows a calm reconnecting state for an already paired device', () => {
    expect(buildConnectionBannerUi({ paired: true, status: 'reconnecting' })).toMatchObject({
      actionLabel: 'Open settings',
      icon: 'wifi',
      title: 'Waiting for the Moxxy Desktop gateway',
      body: 'Socket status: reconnecting. Chat and sessions will sync as soon as the desktop gateway responds.',
    });
  });
});
