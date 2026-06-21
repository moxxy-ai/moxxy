export interface WaitingRoomUi {
  readonly body: string;
  readonly eyebrow: string;
  readonly steps: ReadonlyArray<string>;
  readonly status: string;
  readonly title: string;
}

export function shouldShowWaitingRoom(showConnectionBanner: boolean): boolean {
  return showConnectionBanner;
}

interface BuildWaitingRoomUiInput {
  readonly paired: boolean;
  readonly status: string;
}

export function buildWaitingRoomUi({ paired, status }: BuildWaitingRoomUiInput): WaitingRoomUi {
  if (paired) {
    return {
      body: 'Moxxy is ready on your phone. Keep Moxxy Desktop open and enable Mobile Gateway to continue the same live session.',
      eyebrow: 'Moxxy Mobile',
      status: `Socket status: ${status}`,
      steps: [
        'Open Moxxy Desktop on your Mac.',
        'Go to Settings -> Mobile.',
        'Turn on Enable mobile gateway.',
      ],
      title: 'Waiting for the desktop gateway',
    };
  }

  return {
    body: 'Pair this phone from the desktop app, then your sessions, tools, and live activity will sync here.',
    eyebrow: 'Moxxy Mobile',
    status: 'Not paired yet',
    steps: [
      'Open Moxxy Desktop on your Mac.',
      'Go to Settings -> Mobile.',
      'Turn on Enable mobile gateway and scan the QR code.',
    ],
    title: 'Enable Moxxy Mobile',
  };
}
