/**
 * Running an agent CLI for a check: found the way Moxxy finds it (shims on
 * Windows included), in a home of its own so no sign-in, setting or history of
 * the developer's is read or changed, and spoken to over line JSON-RPC the way
 * the connections speak to it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { resolveExecutableTarget, spawnExecutableTarget } from '../packages/sdk/dist/server.js';

/** Credentials a CLI would pick up from the environment instead of its home. */
const CREDENTIAL_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENCODE_API_KEY'];

/** An environment whose every home-like directory is `home`, with the credential variables unset. */
export function isolatedEnv(home, extra = {}) {
  for (const dir of ['.config', '.local/share', '.local/state', '.cache', 'codex', 'claude', 'tmp']) {
    mkdirSync(path.join(home, dir), { recursive: true });
  }
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, '.config'),
    LOCALAPPDATA: path.join(home, '.local/share'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_STATE_HOME: path.join(home, '.local/state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    CODEX_HOME: path.join(home, 'codex'),
    CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
    TMPDIR: path.join(home, 'tmp'),
    TEMP: path.join(home, 'tmp'),
    TMP: path.join(home, 'tmp'),
    ...extra,
  };
  for (const name of CREDENTIAL_ENV) env[name] = undefined;
  for (const name of Object.keys(process.env)) if (name.startsWith('MOXXY_')) env[name] = undefined;
  return env;
}

export function collect(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => resolve({ code: 1, stdout, stderr, error }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** A command found on `pathEnv` (default: this process's PATH), or null. */
export function findTarget(name, pathEnv = process.env.PATH ?? '') {
  return resolveExecutableTarget(name, { pathEnv });
}

export function runTarget(target, args, options = {}) {
  return collect(spawnExecutableTarget(target, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }));
}

export function runCommand(command, args, options = {}) {
  return collect(spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }));
}

/** The commit a report is about, and whether the working tree differs from it. */
export async function gitState(cwd) {
  const head = await runCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  const changes = await runCommand('git', ['status', '--porcelain'], { cwd });
  return { commit: head.stdout.trim() || 'unknown', dirty: changes.stdout.trim() !== '' };
}

/**
 * A line JSON-RPC 2.0 client over a started target's stdio. A request's
 * deadline only bounds the wait; the process ending answers every request
 * still open at once.
 */
export function startRpc(target, args, options = {}) {
  const child = spawnExecutableTarget(target, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
  const open = new Map();
  let nextId = 1;
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const ended = new Promise((resolve) => child.once('exit', resolve));
  const failAll = (why) => {
    for (const { reject } of open.values()) reject(new Error(`${why}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ''}`));
    open.clear();
  };
  child.once('error', (error) => failAll(`could not start: ${error.message}`));
  child.once('exit', (code) => failAll(`exited with code ${code}`));
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiting = message.id === undefined ? undefined : open.get(message.id);
    if (!waiting || (message.result === undefined && message.error === undefined)) return;
    open.delete(message.id);
    if (message.error) waiting.reject(new Error(`${message.error.message ?? 'error'} (${message.error.code})`));
    else waiting.resolve(message.result);
  });

  return {
    request(method, params, timeoutMs = 60_000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          open.delete(id);
          reject(new Error(`${method} got no answer within ${timeoutMs / 1000}s`));
        }, timeoutMs);
        const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
        open.set(id, { resolve: settle(resolve), reject: settle(reject) });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await ended;
    },
  };
}
