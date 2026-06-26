import type {
  ChannelDef,
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

/**
 * Minimal structural view of the encrypted vault the `/channels` panel needs to
 * read/write a channel's secrets. Kept structural (not the concrete
 * `@moxxy/plugin-vault` `VaultStore`) so plugin-cli takes no dependency on the
 * vault package — the host passes its already-open `VaultStore`, which satisfies
 * this shape.
 */
export interface VaultLike {
  has(name: string): Promise<boolean>;
  set(name: string, value: string): Promise<void>;
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
  /**
   * Accessor for the host's already-open vault, used by the `/channels` panel to
   * store channel secrets. Returns null when no local vault is available (e.g. a
   * thin client attached to an external runner) — the panel then degrades config
   * to a hint. An accessor (not a value) because the vault is created during
   * `bootstrap`, after these props are first rendered.
   */
  readonly getVault?: () => VaultLike | null;
  /**
   * The channels registered at boot (full {@link ChannelDef}s), for the
   * `/channels` panel — the TUI's `ClientSession` doesn't expose the channel
   * registry, so the host (which booted the full session) supplies it. An
   * accessor because the registry is populated during `bootstrap`.
   */
  readonly getChannels?: () => ReadonlyArray<ChannelDef>;
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
