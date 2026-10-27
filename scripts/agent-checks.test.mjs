import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codexKindsFromGenerated,
  diffKinds,
  liveCheckBox,
  newestFixture,
  npmInstallSpec,
  parseAgentArgs,
  renderReport,
  summarize,
  taskRunsInBackground,
} from './agent-checks.mjs';

const byNumber = (a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

test('reads the kinds Codex can send from its generated protocol types', () => {
  const kinds = codexKindsFromGenerated({
    threadItem: 'export type ThreadItem = { "type": "userMessage", id: string } | { "type": "agentMessage", text: string } | { "type": "userMessage" };',
    serverNotification: 'export type ServerNotification = { "method": "turn/started", "params": A } | { "method": "error", "params": B };',
    serverRequest: 'export type ServerRequest = { "method": "item/tool/call", id: RequestId, "params": C };',
  });

  assert.deepEqual(kinds, {
    items: ['agentMessage', 'userMessage'],
    notifications: ['error', 'turn/started'],
    requests: ['item/tool/call'],
  });
});

test('names what a newer agent added and what it took away, per kind', () => {
  const recorded = { items: ['a', 'b'], notifications: ['n1'], requests: ['r1'] };
  const current = { items: ['b', 'c'], notifications: ['n1'], requests: ['r1'] };

  assert.deepEqual(diffKinds(recorded, current), {
    added: { items: ['c'], notifications: [], requests: [] },
    removed: { items: ['a'], notifications: [], requests: [] },
    changed: true,
  });
  assert.equal(diffKinds(recorded, recorded).changed, false);
});

test('picks the fixture of the newest recorded version, not the last listed', () => {
  const files = ['codex-app-server-0.155.1.json', 'codex-model-list-0.163.0.json', 'codex-app-server-0.99.0.json', 'codex-app-server-0.160.2.json'];

  assert.deepEqual(newestFixture(files, 'codex-app-server-', byNumber), { file: 'codex-app-server-0.160.2.json', version: '0.160.2' });
  assert.equal(newestFixture(['other.json'], 'codex-app-server-', byNumber), undefined);
});

test('compares an older CLI with the newest fixture it is not older than', () => {
  const files = ['codex-app-server-0.155.1.json', 'codex-app-server-0.163.0.json'];

  assert.equal(newestFixture(files, 'codex-app-server-', byNumber, '0.155.1')?.version, '0.155.1');
  assert.equal(newestFixture(files, 'codex-app-server-', byNumber, '0.160.0')?.version, '0.155.1');
  assert.equal(newestFixture(files, 'codex-app-server-', byNumber, '0.170.0')?.version, '0.163.0');
  assert.equal(newestFixture(files, 'codex-app-server-', byNumber, '0.150.0'), undefined);
});

test('a failure fails the run, a check left undone leaves it incomplete, not supported counts for nothing', () => {
  const pass = { agent: 'codex', check: 'reply', status: 'pass' };
  const na = { agent: 'codex', check: 'background', status: 'na', detail: 'no shared support yet' };
  const skip = { agent: 'claude', check: 'reply', status: 'skip', detail: 'not signed in' };
  const fail = { agent: 'opencode', check: 'stop', status: 'fail', detail: 'still running' };

  assert.equal(summarize([pass, na]).exitCode, 0);
  assert.equal(summarize([pass, na, skip]).exitCode, 2);
  assert.equal(summarize([pass, skip, fail]).exitCode, 1);
  assert.deepEqual(summarize([pass, na, skip, fail]).counts, { pass: 1, fail: 1, skip: 1, na: 1 });
  assert.equal(summarize([]).exitCode, 2, 'a run that checked nothing is not a success');
});

test('the report names the commit, each agent version and every result with its reason', () => {
  const report = renderReport({
    title: 'Agent connections, live',
    commit: 'abc1234',
    dirty: true,
    startedAt: '2026-10-21T10:00:00.000Z',
    versions: { claude: '2.1.306', codex: '0.163.0' },
    results: [
      { agent: 'claude', check: 'reply', status: 'pass' },
      { agent: 'codex', check: 'stop', status: 'fail', detail: 'the command | kept running' },
      { agent: 'opencode', check: 'reply', status: 'skip', detail: 'OpenCode not installed' },
    ],
  });

  assert.match(report, /^# Agent connections, live/m);
  assert.match(report, /abc1234 \(with uncommitted changes\)/);
  assert.match(report, /\| claude \| 2\.1\.306 \|/);
  assert.match(report, /\| codex \| stop \| FAIL \| the command \\\| kept running \|/);
  assert.match(report, /\| opencode \| reply \| NOT CHECKED \| OpenCode not installed \|/);
  assert.match(report, /Result: FAILED/);
});

test('takes the agents to check from --agent, all of them by default, and refuses an unknown one', () => {
  const known = ['claude', 'codex', 'opencode'];

  assert.deepEqual(parseAgentArgs([], known).agents, known);
  assert.deepEqual(parseAgentArgs(['--agent', 'codex', '--agent=opencode'], known).agents, ['codex', 'opencode']);
  assert.deepEqual(parseAgentArgs(['--install', 'minimum'], known).install, 'minimum');
  assert.throws(() => parseAgentArgs(['--agent', 'grok'], known), /unknown agent "grok"/);
  assert.throws(() => parseAgentArgs(['--install', 'nightly'], known), /--install must be/);
});

test('reads whether the PR author ticked the live check box in the PR description', () => {
  const box = (mark) => `## What\nFixes Stop.\n\n- [${mark}] I ran \`pnpm test:agents:live\` on this PR's latest commit and every agent passed.\n`;

  assert.equal(liveCheckBox(box('x')), 'checked');
  assert.equal(liveCheckBox(box('X')), 'checked');
  assert.equal(liveCheckBox(box(' ')), 'unchecked');
  assert.equal(liveCheckBox('## What\nA body written without the template.'), 'missing');
  assert.equal(liveCheckBox(null), 'missing', 'GitHub sends no body for an empty description');
  assert.equal(
    liveCheckBox('<!-- - [x] I ran `pnpm test:agents:live` -->\n- [ ] I ran `pnpm test:agents:live` on this commit'),
    'unchecked',
    'a box inside an HTML comment of the template does not count',
  );
});

test('a backslash in a detail stays a backslash in the report table, so it cannot unescape a pipe', () => {
  const report = renderReport({
    title: 't',
    commit: 'abc1234',
    dirty: false,
    startedAt: '2026-10-21T10:00:00.000Z',
    versions: {},
    results: [{ agent: 'codex', check: 'stop', status: 'fail', detail: 'C:\\tmp\\| still running' }],
  });

  assert.match(report, /\| C:\\\\tmp\\\\\\\| still running \|/);
});

test('an HTML comment left open hides the rest of the description, as GitHub renders it', () => {
  assert.equal(liveCheckBox('<!-- note\n- [x] I ran `pnpm test:agents:live` on this commit'), 'missing');
  assert.equal(liveCheckBox('<!-- a --> text <!-- b -->\n- [x] I ran `pnpm test:agents:live` on this commit'), 'checked');
});

test("reads from OpenCode's tool list whether its task tool can run a subagent in the background", () => {
  const task = (properties) => [{ id: 'bash', parameters: { properties: { command: {} } } }, { id: 'task', parameters: { properties } }];

  assert.equal(taskRunsInBackground(task({ description: {}, prompt: {}, background: { type: 'boolean' } })), true);
  assert.equal(taskRunsInBackground(task({ description: {}, prompt: {} })), false);
  assert.equal(taskRunsInBackground([{ id: 'bash', parameters: { properties: {} } }]), undefined);
  assert.equal(taskRunsInBackground({ error: 'not a list' }), undefined);
});

test('installs the minimum version from the package it was published under, the newest from the current one', () => {
  const opencode = { npmPackage: '@opencode/cli', minimumVersion: '1.19.0' };
  const codex = { npmPackage: '@openai/codex', minimumVersion: '0.155.1' };

  assert.equal(npmInstallSpec(opencode, 'minimum'), 'opencode-ai@1.19.0');
  assert.equal(npmInstallSpec(opencode, 'latest'), '@opencode/cli@latest');
  assert.equal(npmInstallSpec({ ...opencode, minimumVersion: '2.1.0' }, 'minimum'), '@opencode/cli@2.1.0');
  assert.equal(npmInstallSpec(codex, 'minimum'), '@openai/codex@0.155.1');
});
