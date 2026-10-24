#!/usr/bin/env node
/**
 * Do Claude Code, Codex and OpenCode still speak the way Moxxy's agent
 * connections expect? Checked with no account and no key, so it runs on CI:
 * each CLI starts in a home of its own, answers the handshake its connection
 * opens with, Codex's protocol kinds are compared with the fixture the
 * connection was written against, and OpenCode's HTTP API, which Moxxy reads
 * background subagents from, must be behind Moxxy's password and offer them.
 * No model is called.
 *
 *   pnpm build
 *   node scripts/agent-cli-compat.mjs                    # the CLIs on PATH
 *   node scripts/agent-cli-compat.mjs --install latest   # newest from npm (CI)
 *   node scripts/agent-cli-compat.mjs --install minimum --agent codex
 *
 * Exit 0: every check passed. 1: one failed. 2: a check could not run (a CLI
 * missing, say), which is not a pass.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codexKindsFromGenerated, diffKinds, newestFixture, parseAgentArgs, renderReport, summarize, taskRunsInBackground } from './agent-checks.mjs';
import { findTarget, gitState, isolatedEnv, runTarget, startRpc } from './agent-cli-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (pkg, file) => pathToFileURL(path.join(repoRoot, 'packages', pkg, 'dist', file)).href;
const { CLAUDE_CLI, CODEX_CLI, OPENCODE_CLI, compareVersions, parseVersion } = await import(dist('agent-connection-kit', 'index.js'));
const { CLAUDE_AGENT_SDK_VERSION, ensureClaudeAgentSdk } = await import(dist('plugin-provider-claude-code', 'sdk-install.js'));
const { ACP_PROTOCOL_VERSION } = await import(dist('plugin-provider-acp', 'protocol.js'));
const { CLIENT_CAPABILITIES } = await import(dist('plugin-provider-acp', 'acp-session.js'));
const { OPENCODE_FREE_MODELS } = await import(dist('plugin-provider-acp', 'constants.js'));
const { opencodeAcpLaunch } = await import(dist('plugin-provider-acp', 'executable.js'));

const AGENTS = { claude: CLAUDE_CLI, codex: CODEX_CLI, opencode: OPENCODE_CLI };
const root = mkdtempSync(path.join(tmpdir(), 'moxxy-agent-compat-'));
const results = [];
const versions = {};
const record = (agent, check, status, detail) => {
  results.push({ agent, check, status, ...(detail ? { detail } : {}) });
  console.log(`[${status.toUpperCase()}] ${agent} · ${check}${detail ? ` — ${detail}` : ''}`);
};
const message = (error) => (error instanceof Error ? error.message : String(error));

/** The CLI to check: the one on PATH, or a fresh npm install of the newest or the minimum version. */
async function cliFor(agent, install) {
  const desc = AGENTS[agent];
  if (install === 'path') return { target: findTarget(desc.command) };
  const prefix = path.join(root, `${agent}-cli`);
  const spec = `${desc.npmPackage}@${install === 'latest' ? 'latest' : desc.minimumVersion}`;
  const npm = findTarget('npm');
  if (!npm) throw new Error('npm not found on PATH');
  const installed = await runTarget(npm, ['install', '--prefix', prefix, '--no-fund', '--no-audit', '--loglevel=error', spec]);
  if (installed.code !== 0) throw new Error(`npm install ${spec} failed: ${installed.stderr.trim().slice(-400)}`);
  return { target: findTarget(desc.command, path.join(prefix, 'node_modules', '.bin')) };
}

/** Pass when the CLI runs and is new enough; returns its version, or undefined when the rest cannot run. */
async function checkVersion(agent, target, env) {
  const desc = AGENTS[agent];
  if (!target) {
    record(agent, 'installed', 'skip', `${desc.command} not found; install ${desc.name} or pass --install latest`);
    return undefined;
  }
  const printed = await runTarget(target, ['--version'], { env });
  const version = parseVersion(`${printed.stdout}\n${printed.stderr}`);
  if (!version) {
    record(agent, 'installed', 'fail', `\`${desc.command} --version\` printed no version (exit ${printed.code})`);
    return undefined;
  }
  versions[agent] = version;
  if (compareVersions(version, desc.minimumVersion) < 0) {
    record(agent, 'installed', 'skip', `${version} is older than the ${desc.minimumVersion} Moxxy needs; update it to check compatibility`);
    return undefined;
  }
  record(agent, 'installed', 'pass', `${version} (Moxxy needs ${desc.minimumVersion} or newer)`);
  return version;
}

async function checkClaude(target, env, home) {
  const sdk = await ensureClaudeAgentSdk({ home: path.join(root, 'claude-agent-sdk') });
  const executable = target.kind === 'node' ? target.entry : target.command;
  async function* noPrompt() { await new Promise(() => {}); }
  const query = sdk.query({ prompt: noPrompt(), options: { pathToClaudeCodeExecutable: executable, cwd: home, env: { ...process.env, ...env }, settingSources: [] } });
  try {
    const init = await Promise.race([
      query.initializationResult(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('no answer to the SDK handshake within 60s')), 60_000)),
    ]);
    if (!Array.isArray(init.models) || init.models.length === 0) throw new Error('the handshake listed no models');
    record('claude', 'SDK handshake', 'pass', `Agent SDK ${CLAUDE_AGENT_SDK_VERSION} (the version Moxxy installs) with Claude Code ${init.claude_code_version ?? '?'}: ${init.models.length} models, ${(init.commands ?? []).length} commands`);
  } catch (error) {
    record('claude', 'SDK handshake', 'fail', `Agent SDK ${CLAUDE_AGENT_SDK_VERSION}: ${message(error)}`);
  } finally {
    query.close?.();
  }
}

function findFile(dir, name) {
  const matches = readdirSync(dir, { recursive: true }).map(String).filter((file) => path.basename(file) === name);
  // Codex keeps its current protocol under v2/; prefer it over a legacy copy.
  return matches.sort((a, b) => Number(b.includes('v2')) - Number(a.includes('v2')))[0];
}

async function checkCodex(target, env, version) {
  const out = path.join(root, 'codex-ts');
  const generated = await runTarget(target, ['app-server', 'generate-ts', '--out', out], { env });
  const files = { threadItem: 'ThreadItem.ts', serverNotification: 'ServerNotification.ts', serverRequest: 'ServerRequest.ts' };
  const sources = {};
  for (const [key, name] of Object.entries(files)) {
    const found = generated.code === 0 ? findFile(out, name) : undefined;
    if (!found) {
      record('codex', 'protocol kinds', 'fail', `\`codex app-server generate-ts\` gave no ${name} (exit ${generated.code}) ${generated.stderr.trim().slice(-200)}`);
      return;
    }
    sources[key] = readFileSync(path.join(out, found), 'utf8');
  }
  const fixtures = path.join(repoRoot, 'packages', 'plugin-provider-codex-agent', 'src', 'fixtures');
  const fixture = newestFixture(readdirSync(fixtures), 'codex-app-server-', compareVersions, version);
  if (!fixture) {
    record('codex', 'protocol kinds', 'fail', `no codex-app-server-<version>.json fixture at or below Codex ${version} in ${fixtures}`);
    return;
  }
  const diff = diffKinds(JSON.parse(readFileSync(path.join(fixtures, fixture.file), 'utf8')), codexKindsFromGenerated(sources));
  if (!diff.changed) {
    record('codex', 'protocol kinds', 'pass', `Codex ${version} sends the same kinds as the ${fixture.version} fixture`);
  } else {
    const list = (word, kinds) => Object.entries(kinds).filter(([, names]) => names.length > 0).map(([key, names]) => `${word} ${key}: ${names.join(', ')}`);
    record('codex', 'protocol kinds', 'fail', `Codex ${version} differs from the ${fixture.version} fixture — ${[...list('new', diff.added), ...list('gone', diff.removed)].join('; ')}. Record codex-app-server-${version}.json and decide each kind in event-coverage.test.ts`);
  }

  const rpc = startRpc(target, ['app-server'], { env });
  try {
    await rpc.request('initialize', { clientInfo: { name: 'moxxy', title: 'Moxxy', version: '0.0.0-compat' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized');
    const account = await rpc.request('account/read', {});
    if (!account || !('account' in account)) throw new Error('account/read answered without an account field');
    record('codex', 'app-server handshake', 'pass', 'initialize and account/read answered as Moxxy reads them');
  } catch (error) {
    record('codex', 'app-server handshake', 'fail', message(error));
  } finally {
    await rpc.close();
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * OpenCode's HTTP API, which Moxxy reads background subagents from: behind
 * the password Moxxy gave it, and with background subagents turned on.
 */
async function checkOpenCodeApi(api, home) {
  const events = `${api.url}/event?directory=${encodeURIComponent(home)}`;
  try {
    const refused = await fetch(events);
    await refused.body?.cancel();
    if (refused.status !== 401) throw new Error(`answered ${refused.status} with no password, not 401: OPENCODE_SERVER_PASSWORD no longer guards it`);
    const stream = new AbortController();
    const opened = await fetch(events, { headers: { Authorization: api.authorization }, signal: stream.signal });
    stream.abort();
    const type = opened.headers.get('content-type') ?? '';
    if (opened.status !== 200 || !type.startsWith('text/event-stream')) throw new Error(`its event stream answered ${opened.status} ${type} with the password`);
    record('opencode', 'HTTP API', 'pass', 'refused with no password; event stream open with the one Moxxy gave it');
  } catch (error) {
    record('opencode', 'HTTP API', 'fail', message(error));
  }

  try {
    const model = OPENCODE_FREE_MODELS[0] ?? '';
    const [provider, ...rest] = model.split('/');
    const query = new URLSearchParams({ provider, model: rest.join('/'), directory: home });
    const answer = await fetch(`${api.url}/experimental/tool?${query}`, { headers: { Authorization: api.authorization } });
    const background = taskRunsInBackground(answer.ok ? await answer.json() : undefined);
    if (background === undefined) throw new Error(`its tool list (${answer.status}) has no task tool`);
    if (!background) throw new Error('task takes no background with OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS on: Moxxy shows no background subagents');
    record('opencode', 'background subagents', 'pass', 'task takes background');
  } catch (error) {
    record('opencode', 'background subagents', 'fail', message(error));
  }
}

async function checkOpenCode(target, env, home) {
  // Started as Moxxy starts it: its HTTP API on a port of Moxxy's, behind a password, background subagents on.
  const launch = opencodeAcpLaunch({ port: await freePort(), password: randomBytes(24).toString('base64url'), inherited: {} });
  const rpc = startRpc(target, launch.args, { env: { ...env, ...launch.env }, cwd: home });
  try {
    const init = await rpc.request('initialize', { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES });
    if (init.protocolVersion !== ACP_PROTOCOL_VERSION) throw new Error(`answered with ACP version ${init.protocolVersion}, Moxxy speaks ${ACP_PROTOCOL_VERSION}`);
    const session = await rpc.request('session/new', { cwd: home, mcpServers: [] });
    if (typeof session.sessionId !== 'string') throw new Error('session/new answered without a sessionId');
    record('opencode', 'ACP handshake', 'pass', `ACP ${ACP_PROTOCOL_VERSION}: initialize and session/new answered`);
    // OpenCode serves its HTTP API once it answered `initialize`.
    await checkOpenCodeApi(launch.api, home);
  } catch (error) {
    record('opencode', 'ACP handshake', 'fail', message(error));
  } finally {
    await rpc.close();
  }

  const listed = await runTarget(target, ['models'], { env, cwd: home });
  const offered = new Set(listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const gone = OPENCODE_FREE_MODELS.filter((model) => !offered.has(model));
  if (listed.code !== 0 || offered.size === 0) record('opencode', 'free models', 'fail', `\`opencode models\` listed nothing (exit ${listed.code})`);
  else if (gone.length > 0) record('opencode', 'free models', 'fail', `Moxxy offers ${gone.join(', ')} with no sign-in, but OpenCode no longer lists ${gone.length === 1 ? 'it' : 'them'}`);
  else record('opencode', 'free models', 'pass', `${OPENCODE_FREE_MODELS.join(', ')} still offered`);
}

async function checkAgent(agent, install) {
  const home = path.join(root, `${agent}-home`);
  const env = isolatedEnv(home);
  let target;
  try {
    ({ target } = await cliFor(agent, install));
  } catch (error) {
    record(agent, 'installed', 'fail', message(error));
    return;
  }
  const version = await checkVersion(agent, target, env);
  if (!version) return;
  if (agent === 'claude') await checkClaude(target, env, home);
  if (agent === 'codex') await checkCodex(target, env, version);
  if (agent === 'opencode') await checkOpenCode(target, env, home);
}

async function main() {
  const { agents, install } = parseAgentArgs(process.argv.slice(2), Object.keys(AGENTS));
  const startedAt = new Date().toISOString();
  console.log(`Agent CLI compatibility — ${agents.join(', ')} (${install === 'path' ? 'CLIs on PATH' : `${install} from npm`})`);
  for (const agent of agents) {
    try {
      await checkAgent(agent, install);
    } catch (error) {
      record(agent, 'check', 'fail', message(error));
    }
  }
  const report = renderReport({ title: `Agent CLI compatibility (${install})`, ...(await gitState(repoRoot)), startedAt, versions, results });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(`\n${report}`);
  return summarize(results).exitCode;
}

main()
  .then((code) => { process.exitCode = code; }, (error) => {
    console.error(`[FAIL] ${message(error)}`);
    process.exitCode = 1;
  })
  .finally(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
