// pnpm reports this range when an advisory has no fixed release yet.
const NO_FIX_PUBLISHED = '<0.0.0';

/**
 * Advisories the audit tolerates. An entry holds only while upstream has
 * published no fix and the package is reached solely through the listed paths.
 * `fixOutOfReach` names a published fix the listed `versions` cannot move to:
 * the entry then holds only for that fix and those versions.
 */
export const ACCEPTED_ADVISORIES = [
  {
    id: 'GHSA-g3hv-75wg-m249',
    module: 'minimatch',
    paths: [
      'apps__desktop>electron-builder>app-builder-lib>@electron/asar>minimatch',
      'apps__desktop>electron-builder>app-builder-lib>ejs>jake>filelist>minimatch',
    ],
    fixOutOfReach: '>=11.0.1',
    versions: ['3.1.5', '5.1.9'],
    reason:
      'Build tools only, on our own patterns. Lines 3 and 5 have no fix, and electron-builder pins @electron/asar 3.4.1, which calls minimatch in a way version 11 removed.',
  },
];

function isAccepted(advisory, accepted) {
  const entry = accepted.find((candidate) => candidate.id === advisory.github_advisory_id);
  if (!entry) return false;
  if (advisory.module_name !== entry.module) return false;
  if (advisory.patched_versions !== (entry.fixOutOfReach ?? NO_FIX_PUBLISHED)) return false;
  if (entry.versions && !advisory.findings.every((finding) => entry.versions.includes(finding.version))) return false;
  return advisory.findings.every((finding) => finding.paths.every((path) => entry.paths.includes(path)));
}

export function evaluateAudit(advisories, accepted = ACCEPTED_ADVISORIES) {
  const reported = new Set(advisories.map((advisory) => advisory.github_advisory_id));
  return {
    unmitigated: advisories.filter((advisory) => !isAccepted(advisory, accepted)),
    stale: accepted.filter((entry) => !reported.has(entry.id)),
  };
}
