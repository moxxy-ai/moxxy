import type { UserPromptAttachment } from '@moxxy/sdk';

// ---------- Chat -----------------------------------------------------------

export interface PromptAttachment {
  /** Local-file path the agent should be able to read. Absolute when
   *  picked from the workspace file tree, native-picker path when
   *  picked via Attach. */
  readonly path: string;
  /** Display name (basename of `path`). */
  readonly name: string;
}

/** Whether a runner turn belongs to the visible conversation or is an
 * implementation task owned by a transient surface such as Settings. */
export type RunTurnVisibility = 'foreground' | 'background';

export interface RunTurnArgs {
  prompt: string;
  model?: string;
  /** Defaults to `foreground`. Background turns never drive chat/Focus busy UI. */
  visibility?: RunTurnVisibility;
  attachments?: ReadonlyArray<PromptAttachment>;
  /**
   * Inline attachments for REMOTE clients (the mobile app) that cannot
   * reference host filesystem paths: the payload itself crosses the wire
   * (base64 bytes for image/document/audio, inline text for file/stdin) in
   * the SDK's `UserPromptAttachment` shape, and the host forwards it to
   * `session.runTurn`'s `attachments` option untouched. Path-based
   * `attachments` stay the desktop's local-renderer path.
   */
  inlineAttachments?: ReadonlyArray<UserPromptAttachment>;
}

export interface RunTurnResult {
  turnId: string;
}

/** Authoritative live foreground-turn snapshot from the current driver.
 * Persisted history is deliberately not consulted for this value. */
export interface ActiveTurnSnapshot {
  turnId: string | null;
}
