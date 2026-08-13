import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const patchPath = fileURLToPath(new URL('../patches/image-size@1.2.1.patch', import.meta.url));
const expectedPatchHash = '9b277d19ab0a1890e949143877332bb660a1852b5da8371bf2e29889dcac884d';
const locallyMitigated = new Set(['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr']);

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pnpmConfig = packageJson.pnpm ?? {};
const configuredPatch = pnpmConfig.patchedDependencies?.['image-size@1.2.1'];
if (configuredPatch !== 'patches/image-size@1.2.1.patch') {
  throw new Error('image-size@1.2.1 must remain wired to its reviewed security patch');
}

const actualPatchHash = createHash('sha256').update(readFileSync(patchPath)).digest('hex');
if (actualPatchHash !== expectedPatchHash) {
  throw new Error('the image-size security patch changed; review it and update the expected hash');
}

const audit = spawnSync('pnpm', ['audit', '--json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (audit.error) throw audit.error;

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  throw new Error(`pnpm audit did not return JSON: ${audit.stderr || audit.stdout}`);
}

const advisories = Object.values(report.advisories ?? {});
const unexpected = advisories.filter((advisory) => {
  if (!locallyMitigated.has(advisory.github_advisory_id)) return true;
  if (advisory.module_name !== 'image-size') return true;
  return advisory.findings.some(
    (finding) =>
      finding.version !== '1.2.1' ||
      finding.paths.some((path) => path !== 'apps__mobile>expo>@expo/metro>metro>image-size'),
  );
});

if (unexpected.length > 0) {
  const summary = unexpected
    .map((advisory) => `${advisory.github_advisory_id ?? advisory.id}: ${advisory.module_name}`)
    .join(', ');
  throw new Error(`unmitigated dependency vulnerabilities found: ${summary}`);
}

const observedMitigations = new Set(advisories.map((advisory) => advisory.github_advisory_id));
for (const advisoryId of locallyMitigated) {
  if (!observedMitigations.has(advisoryId)) {
    throw new Error(`${advisoryId} is no longer reported; remove its local exception and patch`);
  }
}

console.log(
  `Security audit passed: 0 unmitigated advisories; ${advisories.length} upstream advisories are covered by the reviewed image-size patch.`,
);
