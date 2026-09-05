import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const patchPath = fileURLToPath(new URL('../patches/image-size@1.2.1.patch', import.meta.url));
const expectedPatchHash = '9b277d19ab0a1890e949143877332bb660a1852b5da8371bf2e29889dcac884d';
const locallyMitigated = new Set(['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr']);
const decodeAdvisory = 'GHSA-vcc3-ghjq-m6fr';

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

// Backport bounded UTF-8 decoding without breaking query-string's CommonJS
// import: upstream 0.5.0 fixes this advisory but switches the package to ESM.
const decodePatch = 'patches/decode-uri-component@0.2.2.patch';
if (pnpmConfig.patchedDependencies?.['decode-uri-component@0.2.2'] !== decodePatch) {
  throw new Error('decode-uri-component@0.2.2 must remain wired to its reviewed security patch');
}
const decodeHash = createHash('sha256')
  .update(readFileSync(new URL(`../${decodePatch}`, import.meta.url))).digest('hex');
if (decodeHash !== '7f74377ee3c760b5955517c299e376917a118afd798224c56b016cfe98aed523') {
  throw new Error('the URI decoder security patch changed; review it and update the expected hash');
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
  if (advisory.github_advisory_id === decodeAdvisory) {
    return advisory.module_name !== 'decode-uri-component' || advisory.findings.some(
      finding => finding.version !== '0.2.2' || finding.paths.some(
        path => path !== 'apps__mobile>expo-router>query-string>decode-uri-component',
      ),
    );
  }
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
for (const advisoryId of [...locallyMitigated, decodeAdvisory]) {
  if (!observedMitigations.has(advisoryId)) {
    throw new Error(`${advisoryId} is no longer reported; remove its local exception and patch`);
  }
}

console.log(
  `Security audit passed: 0 unmitigated advisories; ${advisories.length} upstream advisories are covered by reviewed parser patches.`,
);
