// The single source of truth for how the mobile app presents its connection to
// the desktop. The shell reads ONE value from here instead of juggling
// transportReady / session.connected / error booleans across components.
//
// Two layers feed in: `transportReady` (the WS bridge to the Mac gateway is
// open) and `sessionConnected` (the runner session is live over that bridge).
// We never block the UI on either — this model just drives an inline status
// chip + an optional, non-blocking banner with a way to reconnect/re-pair.

export type ConnectionStatus =
  | 'unpaired' // no stored token — should be at Onboarding, not here
  | 'connecting' // bridge not open yet (first connect / reconnecting), no error
  | 'offline' // bridge can't reach the Mac (gateway off, URL stale, token gone)
  | 'starting' // bridge open, runner session not yet live
  | 'read-only' // connected to an archived/read-only session
  | 'connected'; // fully live

export interface ConnectionStateInput {
  readonly hasToken: boolean;
  readonly transportReady: boolean;
  readonly sessionConnected: boolean;
  readonly readOnly: boolean;
  readonly error: string | null;
}

export interface ConnectionBannerCopy {
  readonly title: string;
  readonly body: string;
  /** Optional how-to-fix steps; empty for the transient connecting state. */
  readonly steps: ReadonlyArray<string>;
}

export interface ConnectionState {
  readonly status: ConnectionStatus;
  /** Header subtitle to show when not fully connected (caller shows the
   *  workspace name when `online`). */
  readonly headerLabel: string;
  /** Drives the header status dot: green when fully live, amber otherwise. */
  readonly online: boolean;
  /** Whether to show the inline ConnectionBanner in the transcript. Only when
   *  the bridge itself is down — once the bridge is open, ordinary chat-history
   *  loading takes over (no banner). */
  readonly showBanner: boolean;
  readonly banner: ConnectionBannerCopy;
}

const CONNECTING_BANNER: ConnectionBannerCopy = {
  title: 'Connecting to your Mac',
  body: 'Reaching the Moxxy Desktop gateway. This is usually quick.',
  steps: [],
};

// Shown when the bridge can't reach the Mac at all. The desktop gateway is
// on-demand and off by default, so the most common cause is simply that it
// isn't running yet — spell out how to turn it on.
const OFFLINE_BANNER: ConnectionBannerCopy = {
  title: "Can't reach your Mac",
  body: 'Moxxy Desktop is unreachable. Make sure the mobile gateway is running, then reconnect.',
  steps: [
    'Open Moxxy Desktop on your Mac.',
    'Open the Mobile tab in the sidebar.',
    'Turn on Enable mobile gateway.',
  ],
};

const UNPAIRED_BANNER: ConnectionBannerCopy = {
  title: 'Pair this phone with your Mac',
  body: 'Scan the QR code from the Mobile tab in Moxxy Desktop to connect.',
  steps: [],
};

export function buildConnectionState({
  hasToken,
  transportReady,
  sessionConnected,
  readOnly,
  error,
}: ConnectionStateInput): ConnectionState {
  if (!hasToken) {
    return { status: 'unpaired', headerLabel: 'Not paired', online: false, showBanner: true, banner: UNPAIRED_BANNER };
  }

  // Bridge not open: never block — show an inline banner with a reconnect path.
  // An error means the bridge gave up (gateway unreachable); otherwise we're
  // still in the normal connect/reconnect window.
  if (!transportReady) {
    return error
      ? { status: 'offline', headerLabel: 'Offline', online: false, showBanner: true, banner: OFFLINE_BANNER }
      : { status: 'connecting', headerLabel: 'Connecting…', online: false, showBanner: true, banner: CONNECTING_BANNER };
  }

  // Bridge is open. From here the existing chat-history loading covers the wait;
  // no connection banner.
  if (!sessionConnected) {
    return { status: 'starting', headerLabel: 'Connecting…', online: false, showBanner: false, banner: CONNECTING_BANNER };
  }

  return readOnly
    ? { status: 'read-only', headerLabel: 'Read-only', online: true, showBanner: false, banner: CONNECTING_BANNER }
    : { status: 'connected', headerLabel: 'Connected', online: true, showBanner: false, banner: CONNECTING_BANNER };
}
