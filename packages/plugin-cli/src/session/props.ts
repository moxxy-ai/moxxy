import type {
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
} from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { SwitchSession } from './sessions-picker.js';

/**
 * Generic shape of a boot-progress step. We keep this loose so the
 * plugin-cli package doesn't depend on `@moxxy/cli`'s setup module —
 * callers translate their own `BootStep`/`BootEvent` into this shape.
 */
export interface InteractiveBootStep {
  readonly kind:
    | 'config-loaded'
    | 'plugins-registered'
    | 'provider-activated'
    | 'provider-failed'
    | 'prefs-applied'
    | 'skills-loaded'
    | 'init-hooks-done'
    | 'ready';
  readonly detail?: string;
  readonly error?: string;
}

export interface InteractiveSessionProps {
  /**
   * Pre-resolved session. When omitted, `bootstrap` must be provided and
   * the TUI renders the BootScreen while initialization runs.
   */
  readonly session?: Session;
  /**
   * Lazy session loader. Called once on mount; the returned promise
   * resolves to the session once boot completes. The `progress` argument
   * is invoked synchronously for each completed step so the BootScreen's
   * checklist can tick off rows live.
   */
  readonly bootstrap?: (progress: (step: InteractiveBootStep) => void) => Promise<Session>;
  readonly registerInteractiveResolver: (
    prompt: (call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>,
  ) => void;
  readonly model?: string;
  /**
   * Optional version string surfaced in the logo + session-info panel.
   * Source of truth: `@moxxy/cli`'s package.json — the bin resolves it
   * at boot and passes it down (avoids putting fs reads in the TUI).
   */
  readonly version?: string;
  /**
   * A newer published `@moxxy/cli` the caller discovered (cheaply, from a
   * cached check). When set, the chat view shows a one-line, auto-dismissing
   * "update available" notice. Omitted ⇒ no banner.
   */
  readonly updateAvailable?: { readonly latest: string };
  /**
   * Skip the splash screen and land directly in the chat view. Used by
   * `moxxy resume` so the seeded event log is visible immediately
   * without the user having to type a first prompt.
   */
  readonly resumed?: boolean;
  /**
   * Host capability that re-points the TUI onto a different session (or a fresh
   * one) in place: it closes the live session, re-opens the runner socket for
   * the new one, and resolves with the new `Session` to re-mount onto. Powers
   * the `/sessions` switcher.
   *
   * Omit it on transports that can't re-bootstrap in place (a thin client
   * attached to an external `moxxy serve`, whose runner owns a single fixed
   * session); `/sessions` then degrades to an explanatory notice.
   */
  readonly switchSession?: SwitchSession;
}
