/**
 * Who an action was taken on behalf of.
 *
 * Until this existed the event log recorded `source` (a CATEGORY: user, model,
 * tool, plugin, system, compactor) but never a subject, so a transcript proved
 * that a machine did something, not that a person did. That makes audit,
 * role-based policy, and cost attribution impossible to build on top, and all
 * three are table stakes for a shared or managed deployment.
 *
 * A `Principal` is deliberately small and provider-neutral: the identity blocks
 * that will issue it (OS user, channel bearer token, OAuth/OIDC subject, a
 * GitHub App installation) agree on this shape and nothing more.
 */
export interface Principal {
  /**
   * Stable identifier within {@link issuer}'s namespace. Only meaningful when
   * paired with the issuer: `alice` from `os` and `alice` from `oidc` are not
   * the same subject, so consumers comparing identities must compare both.
   */
  readonly id: string;
  /**
   * `human` when a person is behind the action, `service` for an unattended
   * runner (a schedule, a webhook, a CI job). The distinction matters to policy:
   * "a human approved this" is a different claim from "a daemon did it".
   */
  readonly kind: 'human' | 'service';
  /**
   * What vouched for the identity: `os`, `channel-token`, `oauth`, or the name
   * of the plugin that resolved it. Records HOW MUCH the identity is worth. An
   * `os` principal is only as trustworthy as local account separation; an
   * `oidc` one carries a verified assertion.
   */
  readonly issuer: string;
  /** Human-readable label for surfaces. Never used for comparison. */
  readonly displayName?: string;
  /**
   * Additional verified attributes (email, groups, tenant). Kept flat and
   * stringly-typed so it survives JSON round-trips through the event log and
   * the runner wire protocol without a schema per issuer.
   */
  readonly claims?: Readonly<Record<string, string>>;
}

/**
 * Whether two principals denote the same subject. Compares issuer AND id: an id
 * is only unique inside its issuer's namespace (see {@link Principal.id}).
 */
export function samePrincipal(a: Principal | undefined, b: Principal | undefined): boolean {
  if (!a || !b) return a === b;
  return a.issuer === b.issuer && a.id === b.id;
}

/**
 * Compact `issuer:id` label for logs and status lines. Deliberately NOT the
 * display name: an audit line has to be unambiguous, and display names are
 * neither unique nor stable.
 */
export function formatPrincipal(principal: Principal | undefined): string {
  return principal ? `${principal.issuer}:${principal.id}` : 'unattributed';
}
