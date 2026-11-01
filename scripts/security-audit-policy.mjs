// pnpm reports this range when an advisory has no fixed release yet.
const NO_FIX_PUBLISHED = '<0.0.0';

/**
 * Advisories the audit tolerates. An entry holds only while upstream has
 * published no fix and the package is reached solely through the listed paths.
 * An entry with `fixedOnlyIn` holds instead while the reported fix is exactly
 * that range: a major the listed paths cannot take. A backport changes the
 * range and ends the acceptance.
 */
export const ACCEPTED_ADVISORIES = [
  {
    id: 'GHSA-g3hv-75wg-m249',
    module: 'minimatch',
    paths: [
      'apps__desktop>electron-builder>app-builder-lib>@electron/asar>minimatch',
      'apps__desktop>electron-builder>app-builder-lib>ejs>jake>filelist>minimatch',
    ],
    fixedOnlyIn: '>=11.0.1',
    reason:
      'Fixed only in minimatch 11, whose named-export API minimatch 3 and 5 callers cannot load; the latest electron-builder still pins both. Build-time only, matching globs Moxxy writes itself.',
  },
];

function isAccepted(advisory, accepted) {
  const entry = accepted.find((candidate) => candidate.id === advisory.github_advisory_id);
  if (!entry) return false;
  if (advisory.module_name !== entry.module) return false;
  if (advisory.patched_versions !== (entry.fixedOnlyIn ?? NO_FIX_PUBLISHED)) return false;
  return advisory.findings.every((finding) => finding.paths.every((path) => entry.paths.includes(path)));
}

export function evaluateAudit(advisories, accepted = ACCEPTED_ADVISORIES) {
  const reported = new Set(advisories.map((advisory) => advisory.github_advisory_id));
  return {
    unmitigated: advisories.filter((advisory) => !isAccepted(advisory, accepted)),
    stale: accepted.filter((entry) => !reported.has(entry.id)),
  };
}
