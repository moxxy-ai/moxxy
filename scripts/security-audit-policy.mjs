// pnpm reports this range when an advisory has no fixed release yet.
const NO_FIX_PUBLISHED = '<0.0.0';

/**
 * Advisories the audit tolerates. An entry holds only while upstream has
 * published no fix and the package is reached solely through the listed paths.
 */
export const ACCEPTED_ADVISORIES = [
  {
    id: 'GHSA-86w9-cpqp-85rv',
    module: 'node-forge',
    paths: ['apps__mobile>expo>@expo/cli>node-forge'],
    reason:
      'RSA signature-verification flaw. @expo/cli only uses node-forge to read local Apple ' +
      'signing certificates during `expo run:ios`; it verifies no signatures and never ships.',
  },
];

function isAccepted(advisory, accepted) {
  const entry = accepted.find((candidate) => candidate.id === advisory.github_advisory_id);
  if (!entry) return false;
  if (advisory.module_name !== entry.module) return false;
  if (advisory.patched_versions !== NO_FIX_PUBLISHED) return false;
  return advisory.findings.every((finding) => finding.paths.every((path) => entry.paths.includes(path)));
}

export function evaluateAudit(advisories, accepted = ACCEPTED_ADVISORIES) {
  const reported = new Set(advisories.map((advisory) => advisory.github_advisory_id));
  return {
    unmitigated: advisories.filter((advisory) => !isAccepted(advisory, accepted)),
    stale: accepted.filter((entry) => !reported.has(entry.id)),
  };
}
