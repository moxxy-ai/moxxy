import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { evaluateAudit } from './security-audit-policy.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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
const { unmitigated, stale } = evaluateAudit(advisories);

if (unmitigated.length > 0) {
  const summary = unmitigated
    .map((advisory) => `${advisory.github_advisory_id ?? advisory.id}: ${advisory.module_name}`)
    .join(', ');
  throw new Error(`unmitigated dependency vulnerabilities found: ${summary}`);
}
if (stale.length > 0) {
  const summary = stale.map((entry) => `${entry.id}: ${entry.module}`).join(', ');
  throw new Error(`accepted advisories are no longer reported; remove them from the policy: ${summary}`);
}

console.log(
  `Security audit passed: 0 unmitigated advisories; ${advisories.length} accepted with no upstream fix.`,
);
