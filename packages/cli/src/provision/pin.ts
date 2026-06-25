const FIRST_PARTY_SCOPE = '@moxxy/';

/**
 * Pin a bare first-party plugin install to the CLI's version so a
 * discovery-installed `@moxxy/plugin-*` matches the bundled `@moxxy/sdk` it
 * links against (first-party packages version in lockstep via the fixed
 * changeset group). An explicit version, a spec that already carries one, a
 * non-`@moxxy` package, or a git/path spec is left untouched.
 *
 * Correct only once first-party packages are co-published at the CLI version,
 * so this is used by `provision()` — which installs only providers NOT already
 * loaded (i.e. ones that must come from npm) — and deliberately NOT by the
 * generic `install_plugin` path, where pinning a third-party or
 * differently-versioned package would break the install.
 */
export function pinFirstPartySpec(
  packageName: string,
  version: string | undefined,
  cliVersion: string | undefined,
): string {
  if (version) return `${packageName}@${version}`;
  // Already carries a version (`@scope/name@1.2.3` → the version `@` is past index 0).
  if (packageName.lastIndexOf('@') > 0) return packageName;
  if (cliVersion && packageName.startsWith(FIRST_PARTY_SCOPE)) {
    return `${packageName}@${cliVersion}`;
  }
  return packageName;
}
