/**
 * The parts of the agent connection checks that touch no CLI, no network and
 * no disk: reading Codex's protocol kinds, comparing them with a fixture, and
 * turning results into an exit code and a report. Shared by
 * agent-cli-compat.mjs (no sign-in, CI) and agent-live-check.mjs (real
 * accounts, a developer's machine).
 */

const STATUS_LABEL = { pass: 'PASS', fail: 'FAIL', skip: 'NOT CHECKED', na: 'N/A' };
const KIND_KEYS = ['items', 'notifications', 'requests'];
export const INSTALL_CHOICES = ['path', 'latest', 'minimum'];

function quotedValues(source, field) {
  const pattern = new RegExp(`"${field}": "([^"]+)"`, 'g');
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

/** What `codex app-server generate-ts` says Codex can send: ThreadItem types, notification and request methods. */
export function codexKindsFromGenerated({ threadItem, serverNotification, serverRequest }) {
  return {
    items: quotedValues(threadItem, 'type'),
    notifications: quotedValues(serverNotification, 'method'),
    requests: quotedValues(serverRequest, 'method'),
  };
}

export function diffKinds(recorded, current) {
  const added = {};
  const removed = {};
  for (const key of KIND_KEYS) {
    const before = new Set(recorded[key] ?? []);
    const after = new Set(current[key] ?? []);
    added[key] = [...after].filter((kind) => !before.has(kind)).sort();
    removed[key] = [...before].filter((kind) => !after.has(kind)).sort();
  }
  const changed = KIND_KEYS.some((key) => added[key].length > 0 || removed[key].length > 0);
  return { added, removed, changed };
}

/**
 * The `<prefix><version>.json` fixture with the highest version, by the caller's comparison.
 * Given `upTo`, only fixtures no newer than it count, so an older CLI is compared with what it shipped.
 */
export function newestFixture(fileNames, prefix, compare, upTo) {
  let newest;
  for (const file of fileNames) {
    if (!file.startsWith(prefix) || !file.endsWith('.json')) continue;
    const version = file.slice(prefix.length, -'.json'.length);
    if (upTo !== undefined && compare(version, upTo) > 0) continue;
    if (!newest || compare(version, newest.version) > 0) newest = { file, version };
  }
  return newest;
}

/** Exit 0 only when something was checked and all of it passed; a check left undone is never a success. */
export function summarize(results) {
  const counts = { pass: 0, fail: 0, skip: 0, na: 0 };
  for (const result of results) counts[result.status] += 1;
  const exitCode = counts.fail > 0 ? 1 : counts.skip > 0 || counts.pass === 0 ? 2 : 0;
  return { counts, exitCode };
}

const RESULT_WORD = { 0: 'PASSED', 1: 'FAILED', 2: 'INCOMPLETE (some checks did not run)' };
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function renderReport({ title, commit, dirty, startedAt, versions, results }) {
  const { counts, exitCode } = summarize(results);
  const lines = [
    `# ${title}`,
    '',
    `- Commit: ${commit}${dirty ? ' (with uncommitted changes)' : ''}`,
    `- Started: ${startedAt}`,
    `- Result: ${RESULT_WORD[exitCode]} — ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} not checked, ${counts.na} not supported`,
    '',
    '| Agent | Version |',
    '| --- | --- |',
    ...Object.entries(versions).map(([agent, version]) => `| ${cell(agent)} | ${cell(version)} |`),
    '',
    '| Agent | Check | Result | Details |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${cell(r.agent)} | ${cell(r.check)} | ${STATUS_LABEL[r.status]} | ${cell(r.detail)} |`),
    '',
  ];
  return lines.join('\n');
}

/** `--agent <id>` (repeatable, default every known agent) and `--install path|latest|minimum`. */
export function parseAgentArgs(argv, known) {
  const agents = [];
  let install = 'path';
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=', 2);
    const value = () => inline ?? argv[++i];
    if (flag === '--agent') {
      const agent = value();
      if (!known.includes(agent)) throw new Error(`unknown agent "${agent}" (known: ${known.join(', ')})`);
      if (!agents.includes(agent)) agents.push(agent);
    } else if (flag === '--install') {
      install = value();
      if (!INSTALL_CHOICES.includes(install)) throw new Error(`--install must be one of ${INSTALL_CHOICES.join(', ')}`);
    } else {
      throw new Error(`unknown option ${argv[i]}`);
    }
  }
  return { agents: agents.length > 0 ? agents : [...known], install };
}

/**
 * The PR template's "I ran `pnpm test:agents:live`" task box: 'checked', 'unchecked', or 'missing' when the
 * description has no such box (written without the template). Boxes inside HTML comments do not count.
 */
export function liveCheckBox(body) {
  const visible = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const box = visible.match(/^\s*[-*]\s+\[([ xX])\]\s+.*`pnpm test:agents:live`/m);
  if (!box) return 'missing';
  return box[1] === ' ' ? 'unchecked' : 'checked';
}
