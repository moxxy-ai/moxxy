import type { ViewStyle } from 'react-native';

const DEFAULT_HEADER_HEIGHT = 64;
const DEFAULT_HEADER_GAP = 18;
const DEFAULT_BOTTOM_GAP = 24;
const DEFAULT_HORIZONTAL_PADDING = 20;
const DEFAULT_ITEM_GAP = 16;

interface ChatListContentStyleInput {
  readonly bottomInset?: number;
  readonly gap?: number;
  readonly headerGap?: number;
  readonly headerHeight?: number;
  readonly horizontalPadding?: number;
}

export interface OfflineEmptyStateCopy {
  readonly body: string;
  readonly title: string;
}

export function buildChatListContentStyle(input: ChatListContentStyleInput = {}): ViewStyle {
  const headerHeight = input.headerHeight ?? DEFAULT_HEADER_HEIGHT;
  const headerGap = input.headerGap ?? DEFAULT_HEADER_GAP;
  const bottomInset = Math.max(0, input.bottomInset ?? 0);
  return {
    flexGrow: 1,
    gap: input.gap ?? DEFAULT_ITEM_GAP,
    paddingBottom: bottomInset + DEFAULT_BOTTOM_GAP,
    paddingHorizontal: input.horizontalPadding ?? DEFAULT_HORIZONTAL_PADDING,
    paddingTop: headerHeight + headerGap,
  };
}

export function buildOfflineEmptyStateCopy(hasConnectionBanner: boolean): OfflineEmptyStateCopy {
  if (hasConnectionBanner) {
    return {
      body: 'Your chat will appear here as soon as the desktop gateway is reachable.',
      title: 'Waiting for connection',
    };
  }

  return {
    body: 'Pick a session from the menu or send a message to drive the same runtime from your phone.',
    title: 'Moxxy Mobile',
  };
}
