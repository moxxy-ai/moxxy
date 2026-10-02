import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCEPTED_ADVISORIES, evaluateAudit } from './security-audit-policy.mjs';

const accepted = [
  {
    id: 'GHSA-aaaa-bbbb-cccc',
    module: 'dev-only-lib',
    paths: ['apps__mobile>tool>dev-only-lib'],
    reason: 'test fixture',
  },
];

function advisory(overrides = {}) {
  return {
    github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
    module_name: 'dev-only-lib',
    patched_versions: '<0.0.0',
    findings: [{ version: '1.0.0', paths: ['apps__mobile>tool>dev-only-lib'] }],
    ...overrides,
  };
}

test('a clean audit passes with no accepted advisories', () => {
  assert.deepEqual(evaluateAudit([], []), { unmitigated: [], stale: [] });
});

test('an advisory nobody accepted is unmitigated', () => {
  const found = advisory({ github_advisory_id: 'GHSA-zzzz-zzzz-zzzz', module_name: 'other' });
  assert.deepEqual(evaluateAudit([found], accepted).unmitigated, [found]);
});

test('an accepted advisory with no upstream fix on its reviewed path passes', () => {
  assert.deepEqual(evaluateAudit([advisory()], accepted), { unmitigated: [], stale: [] });
});

test('an accepted advisory stops being accepted once a fix is published', () => {
  const fixed = advisory({ patched_versions: '>=1.0.1' });
  assert.deepEqual(evaluateAudit([fixed], accepted).unmitigated, [fixed]);
});

test('an accepted advisory reached through an unreviewed path is unmitigated', () => {
  const elsewhere = advisory({
    findings: [{ version: '1.0.0', paths: ['packages__cli>dev-only-lib'] }],
  });
  assert.deepEqual(evaluateAudit([elsewhere], accepted).unmitigated, [elsewhere]);
});

test('an accepted advisory for a different module is unmitigated', () => {
  const other = advisory({ module_name: 'runtime-lib' });
  assert.deepEqual(evaluateAudit([other], accepted).unmitigated, [other]);
});

test('an acceptance that is no longer reported is stale', () => {
  assert.deepEqual(evaluateAudit([], accepted), { unmitigated: [], stale: accepted });
});

test('every shipped acceptance states its module, paths and reason', () => {
  for (const entry of ACCEPTED_ADVISORIES) {
    assert.match(entry.id, /^GHSA(-[a-z0-9]{4}){3}$/);
    assert.ok(entry.module.length > 0);
    assert.ok(entry.paths.length > 0);
    assert.ok(entry.reason.length > 0);
  }
});
