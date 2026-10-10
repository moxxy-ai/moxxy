#!/usr/bin/env node
/**
 * Pre-push gate for the Codex live check. Reads the refs git hands a pre-push
 * hook on stdin and runs `pnpm test:live` only when the push changes code the
 * ChatGPT-subscription provider rides on, so ordinary pushes spend nothing.
 *
 * Local only: the live check signs in with the developer's own ChatGPT login,
 * which must never be copied to CI. Enable once per clone:
 *   git config core.hooksPath .githooks
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZERO = /^0+$/;
const BASE_BRANCH = 'origin/development';

/** Code the live check proves: the provider, its sign-in, and the turn path every request takes. */
const WATCHED = [
  /^packages\/plugin-provider-openai-codex\/(src|test-live)\//,
  /^packages\/plugin-provider-openai-codex\/vitest\.live\.config\.ts$/,
  /^packages\/plugin-oauth\/src\//,
  /^packages\/sdk\/src\/(mode\/|tool-dispatch\.ts$|provider[^/]*\.ts$|events\.ts$)/,
  /^packages\/core\/src\/run-turn\.ts$/,
];
/** Unit tests change no behaviour the live API could reject; the live tests themselves do. */
const UNIT_TEST = /(?<!\.live)\.test\.ts$/;

export function needsLiveCheck(files) {
  return files.some((file) => !UNIT_TEST.test(file) && WATCHED.some((pattern) => pattern.test(file)));
}

/**
 * The commit ranges a push sends. `base` is where a brand-new remote branch
 * grew from; a deleted branch sends no code.
 */
export function changedRanges(stdin, base) {
  const ranges = [];
  for (const line of stdin.split('\n')) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || !remoteSha || ZERO.test(localSha)) continue;
    ranges.push(`${ZERO.test(remoteSha) ? base : remoteSha}..${localSha}`);
  }
  return ranges;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function filesIn(range) {
  const out = git(['diff', '--name-only', range]);
  return out ? out.split('\n') : [];
}

function main() {
  const stdin = readFileSync(0, 'utf8');
  const head = stdin.split('\n').map((line) => line.trim().split(/\s+/)[1]).find((sha) => sha && !ZERO.test(sha));
  if (!head) return 0;
  const base = git(['merge-base', head, BASE_BRANCH]);
  const files = changedRanges(stdin, base).flatMap(filesIn);
  if (!needsLiveCheck(files)) return 0;
  console.log('live-check: this push changes the Codex request path — running pnpm test:live on your ChatGPT sign-in');
  return spawnSync('pnpm', ['test:live'], { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
