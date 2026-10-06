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
  {
    id: 'GHSA-ch52-4w7c-c8xp',
    module: 'http-cache-semantics',
    paths: ['apps__desktop>electron-builder>app-builder-lib>@electron/get>got>cacheable-request>http-cache-semantics'],
    reason:
      'Cross-user disclosure from a shared HTTP cache. @electron/get only caches the Electron release ' +
      'it downloads on the build machine while electron-builder packages the desktop app; no user ' +
      'requests or sessions go through it, and it is not in the installer.',
  },
  {
    id: 'GHSA-vfj7-8cjw-p6xm',
    module: 'braces',
    paths: ['apps__mobile>expo>@expo/metro>metro-file-map>micromatch>braces'],
    reason:
      'Stack exhaustion on deeply nested brace patterns. Metro (the mobile dev bundler) only expands ' +
      'the glob patterns of its own and the project config while it runs on a developer machine; ' +
      'it takes no outside patterns and never ships.',
  },
  {
    id: 'GHSA-hp3w-g68c-fv3c',
    module: 'sprintf-js',
    paths: [
      'apps__mobile>react-native>@react-native/community-cli-plugin>@react-native-community/cli>@react-native-community/cli-config>cosmiconfig>js-yaml>argparse>sprintf-js',
      'apps__desktop>electron-builder>app-builder-lib>@electron/get>global-agent>roarr>sprintf-js',
    ],
    reason:
      'Denial of service through a huge precision in a format string. Both users format only their ' +
      'own fixed strings (argparse its help text in the React Native CLI, roarr its log lines while ' +
      '@electron/get downloads Electron on the build machine); neither takes a format string from ' +
      'outside, and neither ships.',
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
