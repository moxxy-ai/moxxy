/**
 * Minimal numeric `major.minor.patch` comparison. Any prerelease/build suffix
 * (`-rc.1`, `+build2`) is ignored — moxxy release tags are bare `x.y.z`, so this
 * is the precedence the update/check and release paths actually need, without
 * pulling in a full semver dependency.
 *
 * Returns a negative number if `a < b`, positive if `a > b`, `0` if the numeric
 * cores are equal. **When ordering a list where two entries can share a core**
 * (e.g. build-metadata variants), add an explicit, deterministic tie-break at
 * the call site — `Array.prototype.sort` is not guaranteed stable across all
 * inputs, so a `0` here would leave their relative order unspecified.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverCore(a);
  const pb = parseSemverCore(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Parse the leading `major.minor.patch` of a version/tag into a 3-tuple. */
export function parseSemverCore(s: string): [number, number, number] {
  const parts = (s.split('-')[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
