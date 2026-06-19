export type RequirementKind =
  | 'plugin'
  | 'provider'
  | 'tool'
  | 'transcriber'
  | 'synthesizer'
  | 'mode'
  | 'compactor'
  | 'channel'
  | 'agent'
  | 'command'
  | 'runtime';

export type RequirementState = 'registered' | 'active' | 'ready';

/** Fields common to every requirement kind. */
interface RequirementBase {
  readonly name: string;
  readonly state?: RequirementState;
  readonly optional?: boolean;
  readonly reason?: string;
  readonly hint?: string;
}

/**
 * A declared dependency a plugin/config can require be present (and optionally
 * active/ready). It is a discriminated union on `kind`: `version` is ONLY valid
 * on the `plugin` kind, because that is the sole kind whose target resolves a
 * version (see core's `RequirementRegistry.targetInfo`). A `version` on any
 * other kind would compare against an always-undefined target version and
 * report a permanent spurious `version_mismatch`, so the type forbids it at
 * compile time rather than letting it silently slip through.
 */
export type MoxxyRequirement =
  | (RequirementBase & { readonly kind: 'plugin'; readonly version?: string })
  | (RequirementBase & { readonly kind: Exclude<RequirementKind, 'plugin'> });

export interface RequirementIssue {
  readonly requirement: MoxxyRequirement;
  readonly code: 'missing' | 'inactive' | 'not_ready' | 'version_mismatch';
  readonly message: string;
  readonly hint?: string;
}

export interface RequirementCheck {
  readonly ready: boolean;
  readonly issues: ReadonlyArray<RequirementIssue>;
}
