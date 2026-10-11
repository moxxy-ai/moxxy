#!/usr/bin/env node
/**
 * Opt-in live smoke test for the Claude Agent connection (`claude-code`).
 *
 * Unlike scripts/e2e-live.mjs, this consumes no ANTHROPIC_API_KEY: authentication
 * is owned by the user's installed `claude` executable. The harness exits 0 with
 * a clear SKIP when the binary is absent or signed out.
 *
 *   pnpm build
 *   node scripts/e2e-claude-cli-live.mjs
 *
 * The connection under test is the repo's own: the plugin, the agent connection
 * kit and the SDK are packed (`pnpm pack`) and npm-installed into the temporary
 * MOXXY_HOME before Moxxy starts, the way the desktop seeds its plugins, so
 * nothing has to be published first and the CLI does not fetch the npm copy.
 *
 * Override the executable/model with CLAUDE_CODE_EXECUTABLE and
 * MOXXY_CLAUDE_E2E_MODEL. Both runs use generated temporary directories (the
 * Agent SDK installs into the temporary MOXXY_HOME); Claude writes a file only
 * inside a freshly initialized temporary git repo, allowed by --allow-tools.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExecutableTarget, spawnExecutableTarget } from '../packages/sdk/dist/server.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliBin = join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const executable = process.env.CLAUDE_CODE_EXECUTABLE?.trim() || 'claude';
const model = process.env.MOXXY_CLAUDE_E2E_MODEL?.trim() || 'claude-sonnet-5-5';
const root = mkdtempSync(join(tmpdir(), 'moxxy-claude-live-'));
const moxxyHome = join(root, 'moxxy-home');
mkdirSync(moxxyHome);

/** The plugin under test and the repo packages it needs that npm may not have yet. */
const REPO_PACKAGES = ['sdk', 'agent-connection-kit', 'plugin-provider-claude-code'];

function run(command, args, options = {}) {
  return collect(spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }));
}

/** A package manager found on PATH (npm/pnpm are `.cmd` shims on Windows, which plain spawn cannot start). */
function runTool(name, args, options = {}) {
  const target = resolveExecutableTarget(name);
  if (!target) return Promise.resolve({ code: 1, stdout: '', stderr: `${name} not found on PATH` });
  return collect(spawnExecutableTarget(target, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }));
}

function collect(child) {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => resolvePromise({ code: 1, stdout, stderr, error }));
    child.once('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function installRepoPlugin() {
  const tarballs = join(root, 'tarballs');
  mkdirSync(tarballs);
  const files = [];
  for (const name of REPO_PACKAGES) {
    const file = join(tarballs, `${name}.tgz`);
    const packed = await runTool('pnpm', ['pack', '--out', file], { cwd: join(repoRoot, 'packages', name) });
    if (packed.code !== 0) throw new Error(`could not pack packages/${name} (run pnpm build first): ${packed.stderr.trim()}`);
    files.push(file);
  }
  const plugins = join(moxxyHome, 'plugins');
  mkdirSync(plugins);
  writeFileSync(join(plugins, 'package.json'), `${JSON.stringify({ name: 'moxxy-user-plugins', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`);
  const installed = await runTool('npm', ['install', '--prefix', plugins, '--no-fund', '--no-audit', '--install-links=false', ...files]);
  if (installed.code !== 0) throw new Error(`could not install the packed plugin: ${installed.stderr.trim()}`);
  console.log(`[PASS] installed the repo's ${REPO_PACKAGES.join(', ')} from packed tarballs`);
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

function writeConfig(workspace) {
  const config = join(workspace, 'moxxy.config.yaml');
  writeFileSync(config, `plugins:\n  provider:\n    default: claude-code\n    items:\n      claude-code:\n        model: ${model}\n        config:\n          executable: ${JSON.stringify(executable)}\n`);
  return config;
}

async function runMoxxy(workspace, prompt, allowTools = []) {
  const config = writeConfig(workspace);
  const allow = allowTools.length > 0 ? ['--allow-tools', allowTools.join(',')] : [];
  return run(process.execPath, [cliBin, '-p', prompt, '--model', model, '--output-format', 'stream-json', '--config', config, ...allow], {
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
  console.log(`moxxy Claude Agent live smoke — executable=${executable} model=${model}`);
  await installRepoPlugin();

  const textWorkspace = join(root, 'text');
  mkdirSync(textWorkspace);
  const pong = await runMoxxy(textWorkspace, 'Reply with exactly PONG and nothing else.');
  // The agent session record shows Claude Code itself did the turn, through this repo's connection.
  assertTurn('streamed prompt on the Claude Agent connection', pong, ({ events, text }) =>
    events.some((event) => event.type === 'plugin_event' && event.subtype === 'agent_session') &&
    events.some((event) => event.type === 'assistant_chunk') &&
    /PONG/i.test(text));

  const taskRepo = join(root, 'task-repository');
  mkdirSync(taskRepo);
  const git = await run('git', ['init', '--quiet'], { cwd: taskRepo });
  if (git.code !== 0) throw new Error(`could not initialize temporary task repository: ${git.stderr}`);
  const marker = `CLAUDE-SMOKE-${Date.now()}`;
  const task = await runMoxxy(
    taskRepo,
    `Use your Write tool to create smoke-result.txt in the current repository containing exactly ${marker}. Then reply with exactly TASK COMPLETE.`,
    ['Write'],
  );
  assertTurn('isolated repository task with an approved Write', task, ({ text }) => /TASK COMPLETE/i.test(text));
  const changed = await run('git', ['status', '--porcelain', '--', 'smoke-result.txt'], { cwd: taskRepo });
  const contents = readFileSync(join(taskRepo, 'smoke-result.txt'), 'utf8').trim();
  if (!changed.stdout.trim() || contents !== marker) throw new Error('task did not create the expected observable repository change');
  console.log('[PASS] observable file change in generated temporary repository');
}

main().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}).finally(() => rmSync(root, { recursive: true, force: true }));
