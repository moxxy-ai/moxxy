#!/usr/bin/env node
/**
 * Real conversations through Moxxy's agent connections — Claude Code, Codex
 * and OpenCode — on this machine, with the developer's own sign-ins. Run it
 * before merging a change to a connection and before a release; it spends a
 * little of each account's usage. CI cannot run it: it would need the
 * accounts (see agent-cli-compat.mjs for what CI checks instead).
 *
 *   pnpm test:agents:live                     # every agent
 *   pnpm test:agents:live --agent codex       # one agent
 *
 * The connections under test are this repo's: their packages are packed and
 * installed into a throwaway MOXXY_HOME, and `moxxy serve` is driven over its
 * socket the way the desktop drives it. The real ~/.moxxy is never touched; the
 * agent CLIs use their real homes, because that is where the sign-ins live.
 *
 * Models: MOXXY_LIVE_CLAUDE_MODEL (claude-haiku-5-5), MOXXY_LIVE_CODEX_MODEL
 * (gpt-6-luna, medium effort, fast), MOXXY_LIVE_OPENCODE_MODEL (OpenCode's free
 * default). The report is printed and saved under .live-reports/.
 *
 * Exit 0: every check passed. 1: one failed. 2: one could not run (an agent
 * not installed or not signed in) — never reported as a pass.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAgentArgs, renderReport, summarize } from './agent-checks.mjs';
import { findTarget, gitState, runCommand, runTarget } from './agent-cli-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (pkg, file = 'index.js') => pathToFileURL(path.join(repoRoot, 'packages', pkg, 'dist', file)).href;
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const { connectRemoteSession, isRunnerUp, platformSocket } = await import(dist('runner'));
const { AGENT_CLIS, agentCliTargetAt, findAgentCli, readCliVersion } = await import(dist('agent-connection-kit'));
const claude = await import(dist('plugin-provider-claude-code'));
const codex = await import(dist('plugin-provider-codex-agent'));
const opencode = await import(dist('plugin-provider-acp'));

const TURN_LIMIT_MS = 5 * 60_000;
const STOP_LIMIT_MS = 30_000;
const OWN_RULES_ALLOW_CHANGES = "OpenCode's own rules let it change files in the project without asking";

const AGENTS = {
  claude: {
    provider: claude.CLAUDE_CODE_PROVIDER_ID,
    plugin: 'plugin-provider-claude-code',
    command: 'claude',
    model: process.env.MOXXY_LIVE_CLAUDE_MODEL?.trim() || 'claude-haiku-5-5',
    signIn: async () => claude.checkClaudeCliAuth(),
    asksBeforeChange: true,
    background: (command) => `Run this exact shell command with your shell tool's run_in_background option, so it keeps running, and do not wait for it: ${command}. Then reply with exactly BG STARTED.`,
  },
  codex: {
    provider: codex.CODEX_AGENT_PROVIDER_ID,
    plugin: 'plugin-provider-codex-agent',
    command: 'codex',
    model: process.env.MOXXY_LIVE_CODEX_MODEL?.trim() || 'gpt-6-luna',
    context: { reasoning: { effort: 'medium' }, fast: true },
    signIn: async () => codex.checkCodexAuth(),
    asksBeforeChange: true,
    background: (command) => `Run this exact shell command with your exec tool and leave its session running in the background (no nohup, no &; just do not wait for it to finish): ${command}. Then reply with exactly BG STARTED.`,
  },
  opencode: {
    provider: opencode.OPENCODE_PROVIDER_ID,
    plugin: 'plugin-provider-acp',
    command: 'opencode',
    model: process.env.MOXXY_LIVE_OPENCODE_MODEL?.trim() || opencode.OPENCODE_DEFAULT_MODEL,
    signIn: async () => opencode.checkOpenCode(),
    asksBeforeChange: false,
    // OpenCode runs no command in the background; its background work is a subagent (`task` with `background: true`).
    backgroundKind: 'agent',
    background: (command) =>
      `Use your task tool with background set to true to start one general subagent. Its task: run this exact shell command with bash and wait for it to finish: ${command}. Then reply with DONE. Do not wait for the subagent and do not check on it. Reply with exactly BG STARTED.`,
  },
};

const root = mkdtempSync(path.join(tmpdir(), 'moxxy-agent-live-'));
const results = [];
const versions = {};
const record = (agent, check, status, detail) => {
  results.push({ agent, check, status, ...(detail ? { detail } : {}) });
  console.log(`[${status.toUpperCase()}] ${agent} · ${check}${detail ? ` — ${detail}` : ''}`);
};
const message = (error) => (error instanceof Error ? error.message : String(error));
const short = (text, n = 160) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Pack this repo's packages and npm-install them as the home's plugins, the way the desktop seeds its own. */
async function installRepoPlugins(home, plugins) {
  const tarballs = path.join(root, 'tarballs');
  mkdirSync(tarballs, { recursive: true });
  const files = [];
  for (const name of ['sdk', 'agent-connection-kit', ...plugins]) {
    const file = path.join(tarballs, `${name}.tgz`);
    if (!existsSync(file)) {
      const packed = await runTarget(findTarget('pnpm'), ['pack', '--out', file], { cwd: path.join(repoRoot, 'packages', name) });
      if (packed.code !== 0) throw new Error(`could not pack packages/${name} (run pnpm build first): ${packed.stderr.trim()}`);
    }
    files.push(file);
  }
  const dir = path.join(home, 'plugins');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'moxxy-user-plugins', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`);
  const installed = await runTarget(findTarget('npm'), ['install', '--prefix', dir, '--no-fund', '--no-audit', '--install-links=false', ...files]);
  if (installed.code !== 0) throw new Error(`could not install the packed plugins: ${installed.stderr.trim().slice(-400)}`);
}

function yamlConfig(spec) {
  const lines = ['plugins:', '  provider:', `    default: ${spec.provider}`, '    items:', `      ${spec.provider}:`, `        model: ${JSON.stringify(spec.model)}`];
  if (spec.context) {
    lines.push('context:');
    if (spec.context.reasoning) lines.push('  reasoning:', `    effort: ${spec.context.reasoning.effort}`);
    if (spec.context.fast) lines.push('  fast: true');
  }
  return `${lines.join('\n')}\n`;
}

/** A `moxxy serve` runner for one agent, and a client attached to it the way the desktop attaches. */
class Runner {
  constructor(agent, spec, workspace, home) {
    this.agent = agent;
    this.spec = spec;
    this.workspace = workspace;
    this.config = path.join(workspace, '.moxxy-live.yaml');
    writeFileSync(this.config, yamlConfig(spec));
    this.socket = platformSocket(`live-${agent}-${process.pid}`, path.join(root, `${agent}.sock`));
    this.env = { ...process.env, MOXXY_HOME: home, MOXXY_RUNNER_SOCKET: this.socket, MOXXY_SESSION_ID: `live-${agent}` };
    this.output = '';
  }

  async start() {
    this.child = spawn(process.execPath, [cliBin, 'serve', '--config', this.config], { cwd: this.workspace, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk) => (this.output = (this.output + chunk).slice(-4000)));
    this.child.stderr.on('data', (chunk) => (this.output = (this.output + chunk).slice(-4000)));
    const exited = once(this.child, 'exit');
    const deadline = Date.now() + 60_000;
    // The runner says nothing when its socket is bound; like the desktop, try it until it answers or the runner dies.
    while (!(await isRunnerUp(this.socket))) {
      const outcome = await Promise.race([exited.then(() => 'exited'), new Promise((resolve) => setTimeout(resolve, 250, 'again'))]);
      if (outcome === 'exited') throw new Error(`moxxy serve exited before opening its socket: ${short(this.output, 400)}`);
      if (Date.now() > deadline) throw new Error('moxxy serve did not open its socket within 60s');
    }
    this.session = await connectRemoteSession({ socketPath: this.socket, role: 'live-check' });
    this.allow();
    await this.session.setAutoApprove(true);
  }

  /** Answer every approval with yes; `asked` hears each call the person was asked about. */
  allow(asked) {
    this.session.setPermissionResolver({
      name: 'live-check',
      check: async (call) => {
        asked?.push(call?.name ?? 'a call');
        return { mode: 'allow', decidedNow: true };
      },
    });
  }

  /** One turn; its events, the assistant's text, and the errors it reported. */
  async turn(prompt, { signal, onEvent } = {}) {
    const events = [];
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), TURN_LIMIT_MS);
    const both = signal ? AbortSignal.any([signal, limit.signal]) : limit.signal;
    try {
      for await (const event of this.session.runTurn(prompt, { model: this.spec.model, signal: both })) {
        events.push(event);
        onEvent?.(event);
      }
    } finally {
      clearTimeout(timer);
    }
    if (limit.signal.aborted) throw new Error(`the turn did not finish within ${TURN_LIMIT_MS / 60_000} minutes`);
    const text = events.filter((e) => e.type === 'assistant_message').map((e) => e.content).join('\n');
    const errors = events.filter((e) => e.type === 'error').map((e) => e.message);
    return { events, text, errors };
  }

  async stop() {
    await this.session?.close().catch(() => undefined);
    this.session = undefined;
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = once(this.child, 'exit');
    this.child.kill('SIGTERM');
    const outcome = await Promise.race([exited.then(() => 'exited'), new Promise((resolve) => setTimeout(resolve, 20_000, 'stuck'))]);
    if (outcome === 'stuck') {
      this.child.kill('SIGKILL');
      await exited;
      throw new Error('moxxy serve did not stop within 20s of SIGTERM');
    }
  }
}

/** Command lines of this machine's processes, to see whether a command the agent started is still running. */
async function commandLines() {
  const listed = process.platform === 'win32'
    ? await runCommand('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }'])
    : await runCommand('ps', ['-ax', '-o', 'command=']);
  return listed.stdout;
}

async function until(check, limitMs, everyMs = 500) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/** A step that throws fails its check; the run goes on with the next one. */
async function step(agent, check, run) {
  try {
    const detail = await run();
    record(agent, check, 'pass', detail);
    return true;
  } catch (error) {
    record(agent, check, 'fail', message(error));
    return false;
  }
}

function expectTurn({ text, errors }, pattern, what) {
  if (errors.length > 0) throw new Error(`the turn reported: ${short(errors.join('; '), 300)}`);
  if (!pattern.test(text)) throw new Error(`${what}; the reply was: "${short(text)}"`);
}

async function checkAgent(agent) {
  const spec = AGENTS[agent];
  const status = await spec.signIn();
  // Found and started as the connection does: on Windows an npm shim is no program of its own.
  const desc = AGENT_CLIS[spec.provider];
  const file = findAgentCli(desc);
  versions[agent] = `${(file ? await readCliVersion(agentCliTargetAt(desc, file)) : null) ?? 'not installed'} · ${spec.model}`;
  if (status.state !== 'signed-in') {
    record(agent, 'signed in', 'skip', `${short(status.message, 200)} — every check of ${agent} did not run`);
    return;
  }
  record(agent, 'signed in', 'pass', status.accountId ? `as ${status.accountId}` : undefined);

  const home = path.join(root, `${agent}-home`);
  const workspace = path.join(root, `${agent}-work`);
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  await runCommand('git', ['init', '--quiet'], { cwd: workspace });
  await installRepoPlugins(home, [spec.plugin]);

  const word = `KIWI${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const runner = new Runner(agent, spec, workspace, home);
  try {
    await runner.start();

    await step(agent, 'reply', async () => {
      const turn = await runner.turn(`Remember this code word for later: ${word}. For now, reply with exactly PONG and nothing else.`);
      expectTurn(turn, /PONG/i, 'no PONG in the reply');
      return `"${short(turn.text, 40)}"`;
    });

    await step(agent, 'file change', async () => {
      const marker = `LIVE-${Date.now()}`;
      const turn = await runner.turn(`Using your own file tools, create the file live-result.txt in the current directory containing exactly ${marker} and nothing else. Then reply with exactly FILE DONE.`);
      expectTurn(turn, /FILE DONE/i, 'no FILE DONE in the reply');
      const file = path.join(workspace, 'live-result.txt');
      const contents = existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
      if (contents !== marker) throw new Error(contents === undefined ? 'live-result.txt was not created' : `live-result.txt holds "${short(contents, 60)}"`);
      return 'live-result.txt written in the workspace';
    });

    if (spec.asksBeforeChange) {
      await step(agent, 'asks before a change', async () => {
        const asked = [];
        runner.allow(asked);
        await runner.session.setAutoApprove(false);
        try {
          const turn = await runner.turn('Create the file asked.txt in the current directory containing exactly ASKED. Then reply with exactly ASK DONE.');
          const file = path.join(workspace, 'asked.txt');
          if (asked.length === 0) throw new Error(`with auto-approve off the agent asked nothing; it said: "${short(turn.text)}"`);
          if (!existsSync(file)) throw new Error(`the person allowed ${asked.join(', ')}, but asked.txt was not created; the agent said: "${short(turn.text)}"`);
          return `asked about ${asked.join(', ')}, then wrote asked.txt`;
        } finally {
          runner.allow();
          await runner.session.setAutoApprove(true);
        }
      });
    } else {
      record(agent, 'asks before a change', 'na', OWN_RULES_ALLOW_CHANGES);
    }

    await step(agent, 'Moxxy tool', async () => {
      const turn = await runner.turn('Call the tool named recall from the moxxy MCP server, with the query "code word". It is one of your tools. Then reply with exactly TOOL DONE.');
      const call = turn.events.find((e) => e.type === 'tool_call_requested' && /(^|__)recall$/.test(e.name) && e.executedBy !== 'provider');
      if (!call) throw new Error(`the agent did not call Moxxy's recall; it called: ${turn.events.filter((e) => e.type === 'tool_call_requested').map((e) => e.name).join(', ') || 'nothing'}`);
      expectTurn(turn, /TOOL DONE/i, 'no TOOL DONE in the reply');
      return 'recall ran in Moxxy';
    });

    await step(agent, 'remembers the conversation', async () => {
      const turn = await runner.turn('What code word did I give you at the start of this conversation? Reply with just the word.');
      expectTurn(turn, new RegExp(word, 'i'), `the code word ${word} is not in the reply`);
      return `recalled ${word}`;
    });

    await step(agent, 'stop', async () => {
      const marker = `moxxy-live-stop-${process.pid}-${agent}`;
      const stopper = new AbortController();
      let started = false;
      const watching = until(async () => started || (started = (await commandLines()).includes(marker)), 3 * 60_000);
      const turning = runner.turn(`Run this exact shell command with your shell tool, in the foreground, and wait for it to finish: node -e "setTimeout(()=>{},120000)" ${marker}`, { signal: stopper.signal });
      const turnEnded = turning.then(() => 'ended', () => 'ended');
      const first = await Promise.race([watching.then((seen) => (seen ? 'running' : 'never')), turnEnded]);
      if (first !== 'running') throw new Error('the agent never started the command, so there was nothing to stop');
      const pressed = Date.now();
      stopper.abort();
      const stopped = await Promise.race([turnEnded, new Promise((resolve) => setTimeout(resolve, STOP_LIMIT_MS, 'running'))]);
      if (stopped !== 'ended') throw new Error(`the turn was still running ${STOP_LIMIT_MS / 1000}s after Stop`);
      const gone = await until(async () => !(await commandLines()).includes(marker), 20_000);
      if (!gone) throw new Error('the turn stopped, but the command it started is still running');
      return `turn and its command stopped ${Math.round((Date.now() - pressed) / 1000)}s after Stop`;
    });

    await step(agent, 'resumes after a restart', async () => {
      await runner.stop();
      await runner.start();
      const turn = await runner.turn('What code word did I give you at the start of this conversation? Reply with just the word.');
      expectTurn(turn, new RegExp(word, 'i'), `after restarting Moxxy the code word ${word} is not in the reply`);
      return `recalled ${word} after moxxy serve restarted`;
    });

    if (spec.background) {
      await step(agent, 'background work', async () => {
        const marker = `moxxy-live-bg-${process.pid}-${agent}`;
        const command = `node -e "setTimeout(()=>{},300000)" ${marker}`;
        const listed = () => runner.session.getInfo().backgroundWork ?? [];
        const before = new Set(listed().map((work) => work.id));
        const turn = await runner.turn(spec.background(command));
        expectTurn(turn, /BG STARTED/i, 'no BG STARTED in the reply');
        // The label is the agent's own: Codex shows the command, Claude its description of it, OpenCode its subagent's task.
        const kind = spec.backgroundKind ?? 'command';
        let id;
        const running = () => listed().find((work) => (id === undefined ? work.kind === kind && !before.has(work.id) : work.id === id));
        if (!(await until(async () => running() !== undefined, 60_000))) {
          throw new Error(`the ${kind === 'agent' ? 'subagent' : 'command'} is not in what runs in the background; listed: ${JSON.stringify(listed())}`);
        }
        id = running().id;
        // A subagent starts the command a moment after it is listed.
        if (!(await until(async () => (await commandLines()).includes(marker), kind === 'agent' ? 90_000 : 1_000))) {
          throw new Error('the work is listed, but its command is not running on this machine');
        }
        const pressed = Date.now();
        if (!(await runner.session.stopBackgroundWork(id))) throw new Error('Stop said the agent runs no such work');
        const gone = await until(async () => running() === undefined && !(await commandLines()).includes(marker), STOP_LIMIT_MS);
        if (!gone) throw new Error(running() ? `the work is still listed ${STOP_LIMIT_MS / 1000}s after Stop` : 'the work left the list, but its command is still running');
        return `${kind === 'agent' ? 'subagent' : 'command'} listed while it ran, stopped ${Math.round((Date.now() - pressed) / 1000)}s after Stop`;
      });
    }
  } catch (error) {
    record(agent, 'runner', 'fail', message(error));
  } finally {
    await runner.stop().catch((error) => record(agent, 'runner stops', 'fail', message(error)));
  }
}

async function main() {
  const { agents, install } = parseAgentArgs(process.argv.slice(2), Object.keys(AGENTS));
  if (install !== 'path') throw new Error('the live check uses the agent CLIs you are signed in with; --install is for agent-cli-compat.mjs');
  if (!existsSync(cliBin)) throw new Error('packages/cli/dist/bin.js is missing; run pnpm build first');
  const startedAt = new Date().toISOString();
  console.log(`Agent connections, live — ${agents.join(', ')}`);
  for (const agent of agents) {
    try {
      await checkAgent(agent);
    } catch (error) {
      record(agent, 'setup', 'fail', message(error));
    }
  }
  const report = renderReport({ title: 'Agent connections, live', ...(await gitState(repoRoot)), startedAt, versions, results });
  const dir = path.join(repoRoot, '.live-reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agents-live-${startedAt.replace(/[:.]/g, '-')}.md`);
  writeFileSync(file, report);
  console.log(`\n${report}\nSaved: ${path.relative(repoRoot, file)}`);
  return summarize(results).exitCode;
}

main()
  .then((code) => { process.exitCode = code; }, (error) => {
    console.error(`[FAIL] ${message(error)}`);
    process.exitCode = 1;
  })
  .finally(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
