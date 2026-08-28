#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import * as path from 'node:path';

import { seedPluginsFromResources } from '../../../packages/desktop-host/dist/seed-plugins.js';
import { verifyDesktopResources } from './verify-desktop-resources.mjs';

const installerPath = process.argv[2];
const installDir = process.argv[3];

if (process.platform !== 'win32') {
  throw new Error('The NSIS smoke test must run on Windows');
}
if (!installerPath || !installDir) {
  throw new Error('Usage: smoke-windows-installer.mjs <setup.exe> <temporary-install-dir>');
}

const resolvedInstaller = path.resolve(installerPath);
const resolvedInstallDir = path.resolve(installDir);
const resourcesPath = path.join(resolvedInstallDir, 'resources');
const runtimePath = path.join(resolvedInstallDir, 'MoxxyAI Workspaces.exe');
const smokeHome = path.join(resolvedInstallDir, '.smoke-home');
const socketPath = '\\\\.\\pipe\\moxxy-installer-smoke-' + process.pid;
let server;

try {
  await removeInstallDir();
  run(resolvedInstaller, ['/S', `/D=${resolvedInstallDir}`], 120_000);

  await verifyDesktopResources(resourcesPath, { runtimePath });

  await mkdir(smokeHome, { recursive: true });
  await seedPluginsFromResources({
    resourcesPath,
    moxxyHome: smokeHome,
    log: (message) => console.log(message),
  });
  const cliBin = path.join(resourcesPath, 'moxxy-cli', 'dist', 'bin.js');
  const smokeEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    MOXXY_HOME: smokeHome,
    MOXXY_RUNNER_SOCKET: socketPath,
    MOXXY_VAULT_PASSPHRASE: 'installer-smoke-local-only',
  };
  const help = run(runtimePath, [cliBin, '--help'], 30_000, smokeEnv);
  if (!/moxxy/i.test(help) || !/COMMANDS/i.test(help)) {
    throw new Error('Installed CLI returned an unexpected --help response');
  }
  const plugins = run(runtimePath, [cliBin, 'plugins', 'list'], 60_000, smokeEnv);
  if (!plugins.includes('openai-codex')) {
    throw new Error('Installed CLI did not discover the seeded OpenAI Codex provider');
  }
  const loginHelp = run(runtimePath, [cliBin, 'login'], 60_000, smokeEnv, 2);
  if (!/PROVIDERS[\s\S]*openai-codex/i.test(loginHelp)) {
    throw new Error('Installed CLI did not register OpenAI Codex for OAuth login');
  }

  // Reproduce the real clean-machine contract: Node/npm are present, but Git
  // is not a desktop prerequisite. The copied seed lock must keep npm from
  // re-resolving WhatsApp → Baileys → libsignal through a git URL while adding
  // the unrelated optional Piper package.
  const noGitEnv = {
    ...smokeEnv,
    PATH: path.dirname(process.execPath),
  };
  const piperInstall = run(
    runtimePath,
    [cliBin, 'plugins', 'install', '@moxxy/plugin-tts-local'],
    180_000,
    noGitEnv,
  );
  if (!/installed @moxxy\/plugin-tts-local/i.test(piperInstall)) {
    throw new Error('Installed CLI did not report a successful Local Piper install');
  }
  run(
    runtimePath,
    [cliBin, 'plugins', 'enable', '@moxxy/plugin-tts-local'],
    60_000,
    noGitEnv,
  );
  run(
    runtimePath,
    [cliBin, 'plugins', 'set-default', 'synthesizer', 'local-piper'],
    60_000,
    noGitEnv,
  );
  await access(
    path.join(
      smokeHome,
      'plugins',
      'node_modules',
      '@moxxy',
      'plugin-tts-local',
      'dist',
      'index.js',
    ),
  );
  await access(
    path.join(
      smokeHome,
      'plugins',
      'node_modules',
      'sherpa-onnx-win-x64',
      'package.json',
    ),
  );
  console.log('Installed and selected Local Piper without Git on PATH.');

  server = spawn(runtimePath, [cliBin, 'serve'], {
    env: smokeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  server.stdout.on('data', (chunk) => output.push(String(chunk)));
  server.stderr.on('data', (chunk) => output.push(String(chunk)));
  await attachToRunner(socketPath, 60_000, () => output.join(''));
  console.log('Installed runner accepted an attach handshake over a Windows named pipe.');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  try {
    const entries = await readdir(resolvedInstallDir);
    const uninstaller = entries.find((entry) => /^uninstall.*\.exe$/i.test(entry));
    if (uninstaller) run(path.join(resolvedInstallDir, uninstaller), ['/S'], 120_000);
  } finally {
    await removeInstallDir();
  }
}

function removeInstallDir() {
  return rm(resolvedInstallDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 250,
  });
}

function run(command, args, timeout, env = process.env, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    timeout,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) {
    throw new Error(
      `${path.basename(command)} exited with status ${result.status}; expected ${expectedStatus}: ` +
        `${result.stderr ?? ''}${result.stdout ?? ''}`.trim(),
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

async function attachToRunner(pipePath, timeoutMs, serverOutput) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await attachOnce(pipePath);
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED', 'EPIPE'].includes(error?.code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Runner did not accept a named-pipe handshake. Output:\n${serverOutput()}`);
}

function attachOnce(pipePath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('attach handshake timed out'), { code: 'ECONNREFUSED' }));
    }, 2_000);
    const finish = (fn) => {
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    socket.setEncoding('utf8');
    socket.once('error', (error) => finish(() => reject(error)));
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({
          id: 1,
          method: 'attach',
          params: { protocolVersion: 1, role: 'installer-smoke', sinceSeq: 0, replay: 'none' },
        })}\n`,
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.id !== 1) continue;
        if (frame.error) {
          finish(() => reject(new Error(`Runner rejected attach: ${frame.error.message}`)));
          return;
        }
        if (typeof frame.result?.protocolVersion !== 'number') {
          finish(() => reject(new Error('Runner returned an invalid attach response')));
          return;
        }
        finish(resolve);
        return;
      }
    });
  });
}
