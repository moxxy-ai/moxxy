import assert from 'node:assert/strict';
import test from 'node:test';
import { changedRanges, needsLiveCheck } from './live-check.mjs';

const ZERO = '0000000000000000000000000000000000000000';

test('a change to the Codex provider needs the live check', () => {
  assert.equal(needsLiveCheck(['packages/plugin-provider-openai-codex/src/translate.ts']), true);
});

test('changes to the shared turn path the provider rides on need the live check', () => {
  for (const file of [
    'packages/sdk/src/mode/collect-stream.ts',
    'packages/sdk/src/mode/project-messages.ts',
    'packages/sdk/src/tool-dispatch.ts',
    'packages/sdk/src/provider.ts',
    'packages/sdk/src/events.ts',
    'packages/plugin-oauth/src/credential-lock.ts',
    'packages/core/src/run-turn.ts',
  ]) {
    assert.equal(needsLiveCheck([file]), true, file);
  }
});

test('changes elsewhere do not spend the subscription', () => {
  assert.equal(needsLiveCheck([
    'apps/desktop/src/settings/DefaultModel.tsx',
    'packages/plugin-browser/src/page/host.ts',
    'docs/browser-development.md',
    '.changeset/some-change.md',
  ]), false);
});

test('a test-only change to the provider does not need the live check', () => {
  assert.equal(needsLiveCheck(['packages/plugin-provider-openai-codex/src/translate.test.ts']), false);
});

test('a change to the live check itself needs it', () => {
  assert.equal(needsLiveCheck(['packages/plugin-provider-openai-codex/test-live/codex.live.test.ts']), true);
});

test('a pushed branch is compared with what the remote already has', () => {
  const ranges = changedRanges('refs/heads/feat a1 refs/heads/feat b2\n', 'base');
  assert.deepEqual(ranges, ['b2..a1']);
});

test('a new branch is compared with the base it grew from', () => {
  const ranges = changedRanges(`refs/heads/feat a1 refs/heads/feat ${ZERO}\n`, 'mergebase');
  assert.deepEqual(ranges, ['mergebase..a1']);
});

test('deleting a remote branch pushes no code', () => {
  assert.deepEqual(changedRanges(`(delete) ${ZERO} refs/heads/feat b2\n`, 'base'), []);
});
