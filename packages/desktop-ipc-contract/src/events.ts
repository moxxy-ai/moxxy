import type { MoxxyEvent, SurfaceDataMessage } from '@moxxy/sdk';

import type { AskRequest } from './ask.js';
import type { ConnectionPhase } from './connection.js';
import type { AppUpdateProgress } from './app-update.js';
import type { DeepLinkPayload } from './deep-link.js';
import type { MobileGatewayStatus } from './mobile.js';

// ---------- Events the renderer subscribes to ------------------------------

/**
 * Channel names. Centralized so a typo is caught at the type level
 * (the preload's `subscribe(channel, handler)` is generic over this
 * map).
 */
export interface IpcEvents {
  /** Phase of the supervisor for `workspaceId`. The renderer's
   *  ConnectionStore keeps one phase per workspace; the foreground UI
   *  reads only the active workspace's. */
  'connection.changed': { workspaceId: string; phase: ConnectionPhase };
  /** Runner event tagged with the workspace it came from so the
   *  renderer can dispatch into the right per-workspace chat state. */
  'runner.event': { workspaceId: string; event: MoxxyEvent };
  'runner.turn.complete': {
    workspaceId: string;
    turnId: string;
    error: string | null;
  };
  /** Streamed during `onboarding.installMoxxyCli`. One event per
   *  stdout/stderr line; the invoke() also returns the final exit
   *  code so callers can short-circuit on success. */
  'onboarding.install.progress': string;
  /** Streamed during `app.updateDashboard` — one event per download/verify/
   *  extract/activate step so the Updates UI can show a progress bar. */
  'app.update.progress': AppUpdateProgress;
  /** The runner needs a permission/approval decision — the renderer
   *  shows a bottom sheet and replies via `ask.respond`. */
  'ask.request': AskRequest;
  /** A `moxxy://` URL was opened while the app is running (notification /
   *  action link, or an OS protocol launch). The renderer's DeepLinkBridge
   *  routes it by `host`/`path`. Links that arrive before the renderer is
   *  listening are buffered and pulled via `deepLink:drain` on mount. */
  'deepLink:received': DeepLinkPayload;
  /** The mobile gateway's status changed (enabled/disabled, token rotated, a
   *  client connected/left) — the Settings → Mobile tab re-renders the QR +
   *  client count from this without polling. */
  'mobileGateway.changed': MobileGatewayStatus;
  /** The runner's registry snapshot changed (provider/mode/MCP/workflow
   *  mutations — including ones made by TOOLS inside a turn, e.g.
   *  provider_add). The renderer re-emits {@link SESSION_INFO_REFRESH_EVENT}
   *  on its EventBus so every info-derived view (Settings tabs, mode badge,
   *  action catalog) refreshes without polling or an app restart. */
  'session.info.changed': { workspaceId: string };
  /** A running interactive provider login (`provider.login.start`) needs a
   *  pasted answer — the out-of-band token or `code#state` claude-code's flow
   *  asks for. The renderer renders an input (masked when `mask`) and replies
   *  via `provider.login.answer`. Loopback providers never emit this. */
  'provider.login.prompt': { loginId: string; question: string; mask: boolean };
  /** Streamed stdout/stderr text from a running provider login (progress, the
   *  authorize URL, the final summary). One event per chunk. */
  'provider.login.output': { loginId: string; text: string };
  /** A provider login finished. `code === 0` ⇒ signed in. */
  'provider.login.done': { loginId: string; code: number };
  /** A frame from an open agentic surface (terminal bytes, a browser frame, a
   *  url/title update) for `workspaceId`. The renderer routes it to the
   *  matching pane by `data.surfaceId` and ignores frames for panes it isn't
   *  showing. Forwarded verbatim from the runner's `surface.data`. */
  'surface.data': { workspaceId: string; data: SurfaceDataMessage };
}
