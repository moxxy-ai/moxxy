export interface ChatConnectionUiInput {
  readonly gatewayConnected: boolean;
  readonly selectedSessionConnected: boolean;
  readonly selectedSessionReadOnly: boolean;
  readonly sending: boolean;
}

export interface ChatConnectionUi {
  readonly statusLabel: 'Thinking' | 'Connected' | 'Read-only' | 'Offline';
  readonly showConnectionBanner: boolean;
  readonly bannerConnected: boolean;
}

export function buildChatConnectionUi(input: ChatConnectionUiInput): ChatConnectionUi {
  if (input.sending) {
    return {
      bannerConnected: input.gatewayConnected,
      showConnectionBanner: !input.gatewayConnected,
      statusLabel: 'Thinking',
    };
  }

  if (!input.gatewayConnected) {
    return {
      bannerConnected: false,
      showConnectionBanner: true,
      statusLabel: 'Offline',
    };
  }

  if (input.selectedSessionConnected) {
    return {
      bannerConnected: true,
      showConnectionBanner: false,
      statusLabel: 'Connected',
    };
  }

  return {
    bannerConnected: true,
    showConnectionBanner: false,
    statusLabel: input.selectedSessionReadOnly ? 'Read-only' : 'Connected',
  };
}
