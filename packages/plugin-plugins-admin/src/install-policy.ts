import { MoxxyError } from '@moxxy/sdk';

/**
 * How much freedom a machine has over what it installs.
 *
 * `moxxy plugins install` runs `npm install` against whatever spec it is given:
 * a bare name, `name@version`, a git URL, or a filesystem path. On a personal
 * machine that is the point. On a managed fleet it means the supply chain has
 * no boundary at all, and an organisation had no way to draw one.
 *
 *   - `open`:          anything installs. The default; unchanged behaviour.
 *   - `registry-only`: only packages the SIGNED registry index vouches for.
 *     The index is Ed25519-verified and pins an exact version, so this is the
 *     setting that makes "we only run reviewed code" enforceable rather than
 *     aspirational.
 *   - `denied`:        nothing installs. For an image built once and shipped,
 *     where any install at runtime is by definition drift.
 *
 * Enforced inside the install function rather than at the CLI surface, because
 * the `install_plugin` MODEL tool reaches the same path. A policy the agent
 * could route around by asking itself would not be a policy.
 */
export type InstallPolicy = 'open' | 'registry-only' | 'denied';

export const INSTALL_POLICIES: ReadonlyArray<InstallPolicy> = ['open', 'registry-only', 'denied'];

export function isInstallPolicy(value: unknown): value is InstallPolicy {
  return typeof value === 'string' && (INSTALL_POLICIES as ReadonlyArray<string>).includes(value);
}

export interface InstallPolicyCheck {
  readonly policy: InstallPolicy;
  /** The spec the caller wants to install. */
  readonly spec: string;
  /**
   * Whether the signed registry vouched for this spec. Resolved by the caller
   * (which already consults the index for the version pin), so this module
   * stays a pure decision and needs no network.
   */
  readonly signed: boolean;
}

/**
 * Throw when policy forbids the install. Returns nothing on success so the
 * call site reads as a guard.
 *
 * The errors name the policy and where it came from: a developer hitting a
 * managed restriction should learn that a policy exists, not just that npm
 * refused, or the next thing they try is to work around it.
 */
export function assertInstallAllowed(check: InstallPolicyCheck): void {
  if (check.policy === 'open') return;
  if (check.policy === 'denied') {
    throw new MoxxyError({
      code: 'TOOL_ERROR',
      message: `installing plugins is disabled on this machine (plugins.installPolicy: denied)`,
      hint: 'Add the package to the config manifest and provision it with `moxxy sync`, or ask an operator to relax plugins.installPolicy.',
      context: { spec: check.spec, policy: check.policy },
    });
  }
  if (!check.signed) {
    throw new MoxxyError({
      code: 'TOOL_ERROR',
      message: `"${check.spec}" is not in the signed plugin registry (plugins.installPolicy: registry-only)`,
      hint: 'Only packages the signed index vouches for may be installed. Publish it to your registry, or ask an operator to relax plugins.installPolicy.',
      context: { spec: check.spec, policy: check.policy },
    });
  }
}
