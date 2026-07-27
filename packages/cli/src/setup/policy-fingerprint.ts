import { createHash } from 'node:crypto';
import type { MoxxyConfig } from '@moxxy/config';

/**
 * A fingerprint of the security-relevant configuration in force.
 *
 * An audit trail without this says what was done but not what the rules WERE at
 * the time, and "was this allowed under the policy that applied then" is the
 * first question asked when reviewing a past run. Recording the whole config
 * would put site secrets and irrelevant preferences into the trail, so a
 * fingerprint plus a small human-readable summary is the useful middle: enough
 * to prove two runs executed under the same rules, and to see at a glance which
 * rules those were.
 */

/**
 * The settings that decide what the agent may DO. Preferences (theme, model
 * choice, skills directories) are deliberately absent: including them would
 * make the fingerprint churn on changes that cannot affect what was permitted,
 * and a fingerprint that changes for irrelevant reasons stops being evidence.
 */
export interface PolicySummary {
  readonly securityEnabled: boolean;
  readonly requireDeclaration: boolean;
  readonly thirdPartyRequireDeclaration: string;
  readonly isolator: string;
  readonly allowExecutableConfig: boolean;
  readonly installPolicy: string;
  readonly auditEnabled: boolean;
  /** Counts only. The rules themselves can name internal paths. */
  readonly managedAllowRules: number;
  readonly managedDenyRules: number;
  /** Whether egress is pinned, not to where. */
  readonly proxyPinned: boolean;
}

export function policySummary(config: MoxxyConfig): PolicySummary {
  const proxy = config.network?.proxy;
  return {
    securityEnabled: config.security?.enabled ?? false,
    requireDeclaration: config.security?.requireDeclaration ?? false,
    // 'warn' is the plugin-side default while security is enabled, so report
    // the EFFECTIVE value rather than the literal absence of a key.
    thirdPartyRequireDeclaration: config.security?.thirdPartyRequireDeclaration ?? 'warn',
    isolator: config.plugins?.isolator?.default ?? 'inproc',
    allowExecutableConfig: config.config?.allowExecutable ?? true,
    installPolicy: config.plugins?.installPolicy ?? 'open',
    auditEnabled: config.audit?.enabled ?? false,
    managedAllowRules: config.permissions?.allow?.length ?? 0,
    managedDenyRules: config.permissions?.deny?.length ?? 0,
    proxyPinned: typeof proxy === 'string' && proxy !== 'env' && proxy !== 'off',
  };
}

/**
 * SHA-256 over the summary, with keys emitted in a fixed order.
 *
 * Fixed order rather than `JSON.stringify`'s insertion order for the same
 * reason the audit chain uses one: two configs with identical policy must
 * fingerprint identically, or comparing two runs becomes meaningless the moment
 * one of them round-tripped through a different serializer.
 */
export function policyFingerprint(summary: PolicySummary): string {
  const ordered = Object.entries(summary)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, v] as const);
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
