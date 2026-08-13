#!/usr/bin/env node
/**
 * Opt-in live smoke test for the installed Claude CLI subscription provider.
 *
 * Unlike scripts/e2e-live.mjs, this consumes no ANTHROPIC_API_KEY: authentication
 * is owned by the user's installed `claude` executable. The harness exits 0 with
 * a clear SKIP when the binary is absent or signed out.
 *
 *   pnpm build
 *   node scripts/e2e-claude-cli-live.mjs
 *
 * Override the executable/model with CLAUDE_CODE_EXECUTABLE and
 * MOXXY_CLAUDE_E2E_MODEL. Both runs use generated temporary directories; the
 * native-tool task runs only inside a freshly initialized temporary git repo.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliBin = join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const executable = process.env.CLAUDE_CODE_EXECUTABLE?.trim() || 'claude';
const model = process.env.MOXXY_CLAUDE_E2E_MODEL?.trim() || 'claude-sonnet-5';
const root = mkdtempSync(join(tmpdir(), 'moxxy-claude-live-'));
const moxxyHome = join(root, 'moxxy-home');
mkdirSync(moxxyHome);

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => resolvePromise({ code: 1, stdout, stderr, error }));
    child.once('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

function authIsSignedIn(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed.loggedIn === true || parsed.logged_in === true || parsed.authenticated === true;
  } catch {
    return /logged in|authenticated|signed in/i.test(stdout) && !/not logged in|signed out|not authenticated/i.test(stdout);
  }
}

function eventsFrom(stdout) {
  return stdout.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function assistantText(events) {
  return events.flatMap((event) => {
    if (event.type === 'assistant_chunk' && typeof event.delta === 'string') return [event.delta];
    if (event.type === 'assistant_message' && typeof event.content === 'string') return [event.content];
    return [];
  }).join('\n');
}

function writeConfig(workspace, nativeTools) {
  const config = join(workspace, 'moxxy.config.yaml');
  const native = nativeTools
    ? "\n          mode: native-tools\n          permissionMode: acceptEdits\n          allowedTools:\n            - Write\n            - Edit"
    : '';
  writeFileSync(config, `plugins:\n  provider:\n    default: claude-code\n    items:\n      claude-code:\n        model: ${model}\n        config:\n          executable: ${JSON.stringify(executable)}${native}\n`);
  return config;
}

async function runMoxxy(workspace, prompt, nativeTools = false) {
  const config = writeConfig(workspace, nativeTools);
  return run(process.execPath, [cliBin, '-p', prompt, '--model', model, '--output-format', 'stream-json', '--config', config], {
    cwd: workspace,
    env: { ...process.env, MOXXY_HOME: moxxyHome },
  });
}

function assertTurn(label, result, predicate) {
  const events = eventsFrom(result.stdout);
  const errors = events.filter((event) => event.type === 'error');
  const text = assistantText(events);
  if (result.code !== 0 || errors.length > 0 || !predicate({ events, text })) {
    throw new Error(`${label} failed (exit ${result.code}): ${errors.map((e) => e.message).join('; ') || result.stderr.trim() || 'assertion failed'}`);
  }
  console.log(`[PASS] ${label}`);
  return { events, text };
}

async function main() {
  const auth = await run(executable, ['auth', 'status']);
  if (auth.error?.code === 'ENOENT') {
    console.log(`[SKIP] Claude CLI not found (${executable}). Install Claude Code, then run \`claude auth login\`.`);
    return;
  }
  if (!authIsSignedIn(auth.stdout)) {
    console.log(`[SKIP] Claude CLI is installed but not signed in. Run \`${executable} auth login\` (or \`moxxy login claude-code\`) and retry.`);
    return;
  }
  console.log(`moxxy Claude CLI live smoke — executable=${executable} model=${model}`);

  const textWorkspace = join(root, 'text');
  mkdirSync(textWorkspace);
  const pong = await runMoxxy(textWorkspace, 'Reply with exactly PONG and nothing else.');
  assertTurn('streamed subscription prompt', pong, ({ events, text }) =>
    events.some((event) => event.type === 'assistant_chunk') && /PONG/i.test(text));

  const taskRepo = join(root, 'task-repository');
  mkdirSync(taskRepo);
  const git = await run('git', ['init', '--quiet'], { cwd: taskRepo });
  if (git.code !== 0) throw new Error(`could not initialize temporary task repository: ${git.stderr}`);
  const marker = `CLAUDE-SMOKE-${Date.now()}`;
  const task = await runMoxxy(
    taskRepo,
    `Use your native Write tool to create smoke-result.txt in the current repository containing exactly ${marker}. Then reply with exactly TASK COMPLETE.`,
    true,
  );
  assertTurn('isolated native-tool repository task', task, ({ text }) => /TASK COMPLETE/i.test(text));
  const changed = await run('git', ['status', '--porcelain', '--', 'smoke-result.txt'], { cwd: taskRepo });
  const contents = readFileSync(join(taskRepo, 'smoke-result.txt'), 'utf8').trim();
  if (!changed.stdout.trim() || contents !== marker) throw new Error('task did not create the expected observable repository change');
  console.log('[PASS] observable file change in generated temporary repository');
}

main().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}).finally(() => rmSync(root, { recursive: true, force: true }));
