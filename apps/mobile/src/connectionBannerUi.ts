import type { MobileIconName } from './components/MobileIcon';

export interface ConnectionBannerUi {
  readonly actionLabel: string;
  readonly body: string;
  readonly icon: MobileIconName;
  readonly steps: ReadonlyArray<string>;
  readonly title: string;
}

interface BuildConnectionBannerUiInput {
  readonly paired: boolean;
  readonly status: string;
}

export function buildConnectionBannerUi({ paired, status }: BuildConnectionBannerUiInput): ConnectionBannerUi {
  if (paired) {
    return {
      actionLabel: 'Open settings',
      body: `Socket status: ${status}. Chat and sessions will sync as soon as the desktop gateway responds.`,
      icon: 'wifi',
      steps: [
        'Keep Moxxy Desktop open on your Mac.',
        'Check that the Mobile tab has the gateway enabled.',
        'Stay on the same Wi-Fi network as this phone.',
      ],
      title: 'Waiting for the Moxxy Desktop gateway',
    };
  }

  return {
    actionLabel: 'Open settings',
    body: 'Open Moxxy Desktop, open the Mobile tab in the sidebar, then turn on Enable mobile gateway and pair this phone.',
    icon: 'wifiOff',
    steps: [
      'Open Moxxy Desktop on your Mac.',
      'Open the Mobile tab in the sidebar.',
      'Turn on Enable mobile gateway.',
      'Return here and pair this phone.',
    ],
    title: 'Enable Moxxy Mobile on your desktop',
  };
}
