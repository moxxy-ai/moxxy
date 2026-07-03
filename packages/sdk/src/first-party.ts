/**
 * The npm scope every first-party moxxy package lives under. First-party
 * packages are the trusted, co-versioned set (published together via the
 * fixed changeset group); anything outside this scope is third-party code
 * the user pulled in from the registry and gets stricter treatment:
 * post-install capability consent and the `thirdPartyRequireDeclaration`
 * ratchet in `@moxxy/plugin-security`.
 */
export const FIRST_PARTY_PLUGIN_SCOPE = '@moxxy/';

/**
 * Whether a package name belongs to the trusted first-party scope. The input
 * is a bare npm package name (`@moxxy/plugin-x`, `some-plugin`) — pass names,
 * not install specs (`name@1.2.3` would still work, but git/path specs are
 * not names and should be resolved to one first).
 */
export function isFirstPartyPackage(packageName: string): boolean {
  return packageName.startsWith(FIRST_PARTY_PLUGIN_SCOPE);
}
