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

export interface SessionInfo {
  readonly providers: ReadonlyArray<ProviderInfo>;
  readonly modes: ReadonlyArray<string>;
  readonly activeProvider: string | null;
  readonly activeMode: string | null;
}

/**
 * Window event the AgentPicker listens for to re-fetch session.info. The
 * composer dispatches it after switching the mode out-of-band (e.g. the Goal
 * button) so the Mode chip reflects the change without waiting for a remount.
 */
export const SESSION_INFO_REFRESH_EVENT = 'moxxy:session-info-refresh';
