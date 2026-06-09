/**
 * Shared session-shape types for the agent picker. A trimmed view of
 * the runner's SessionInfo — only the provider / model / mode fields
 * the composer chips actually render.
 */

/** Subset of SessionInfo's ProviderInfo we actually render. Model id
 *  is the model identifier the runner uses (e.g. "gpt-4o") — earlier
 *  versions of this code read `models[i].name` which doesn't exist on
 *  ModelDescriptor, so the right column always rendered empty. */
export interface ProviderInfo {
  readonly name: string;
  readonly models: ReadonlyArray<{ readonly id: string }>;
}

/**
 * Presentation hint the active mode advertises (subset of the SDK's
 * `ModeBadge`). When present the composer renders a persistent accent banner
 * + an accented Mode chip so an autonomous mode (goal mode) is unmistakable.
 */
export interface ModeBadge {
  readonly label: string;
  readonly tone?: 'attention' | 'info';
}

export interface SessionInfo {
  readonly providers: ReadonlyArray<ProviderInfo>;
  readonly modes: ReadonlyArray<string>;
  readonly activeProvider: string | null;
  readonly activeMode: string | null;
  readonly activeModeBadge: ModeBadge | null;
}

/**
 * Window/event-bus key the AgentPicker listens for to re-fetch session.info. The
 * composer dispatches it after switching the mode out-of-band (e.g. the Goal
 * button) so the Mode chip reflects the change without waiting for a remount.
 * Sourced from the shared IPC contract so the desktop dispatch sites and the
 * shared `useActiveModeBadge` hook can't drift apart.
 */
export { SESSION_INFO_REFRESH_EVENT } from '@moxxy/desktop-ipc-contract';
