import { p, handleCancel, withSpinner } from '../ui.js';
import { getMoxxyHome } from './init.js';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const PLIST_LABEL = 'ai.moxxy.gateway';
const SYSTEMD_UNIT = 'moxxy-gateway.service';

function paths() {
  const home = getMoxxyHome();
  const bin = join(home, 'bin', 'moxxy-gateway');
  const logDir = join(home, 'logs');
  const logFile = join(logDir, 'gateway.log');
  const pidFile = join(home, 'gateway.pid');
  return { home, bin, logDir, logFile, pidFile };
}

function findBinary() {
  const { bin } = paths();
  if (existsSync(bin)) return bin;

  // Check PATH
  try {
    const found = execSync('which moxxy-gateway', { encoding: 'utf-8' }).trim();
    if (found) return found;
  } catch { /* not on PATH */ }

  return null;
}

// --- Platform-specific service management ---

function plistPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
}

function systemdUnitPath() {
  return join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
}

function generatePlist(binaryPath) {
  const { logFile, logDir } = paths();
  mkdirSync(logDir, { recursive: true });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MOXXY_HOME</key>
    <string>${getMoxxyHome()}</string>
  </dict>
</dict>
</plist>`;
}

function generateSystemdUnit(binaryPath) {
  const { logFile, logDir } = paths();
  mkdirSync(logDir, { recursive: true });

  return `[Unit]
Description=Moxxy Gateway
After=network.target

[Service]
Type=simple
ExecStart=${binaryPath}
Environment=MOXXY_HOME=${getMoxxyHome()}
StandardOutput=append:${logFile}
StandardError=append:${logFile}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target`;
}

// --- Actions ---

async function startGateway() {
  const binary = findBinary();
  if (!binary) {
    p.log.error('moxxy-gateway binary not found.');
    p.log.info('Install it with: curl -fsSL https://moxxy.ai/install.sh | sh');
    process.exitCode = 1;
    return;
  }

  const os = platform();

  if (os === 'darwin') {
    await startLaunchd(binary);
  } else if (os === 'linux') {
    await startSystemd(binary);
  } else {
    await startFallback(binary);
  }
}

async function startLaunchd(binary) {
  const plist = plistPath();
  const dir = join(homedir(), 'Library', 'LaunchAgents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(plist, generatePlist(binary));

  try {
    // Bootout first in case it's already loaded
    execSync(`launchctl bootout gui/$(id -u) ${plist} 2>/dev/null`, { stdio: 'ignore' });
  } catch { /* not loaded, fine */ }

  execSync(`launchctl bootstrap gui/$(id -u) ${plist}`);
  execSync(`launchctl kickstart -k gui/$(id -u)/${PLIST_LABEL}`);

  await verifyStarted();
}

async function startSystemd(binary) {
  const unitPath = systemdUnitPath();
  const dir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  writeFileSync(unitPath, generateSystemdUnit(binary));

  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user start ${SYSTEMD_UNIT}`);

  await verifyStarted();
}

async function startFallback(binary) {
  const { logDir, logFile, pidFile } = paths();
  mkdirSync(logDir, { recursive: true });

  const { openSync } = await import('node:fs');
  const logFd = openSync(logFile, 'a');

  const env = { ...process.env, MOXXY_HOME: getMoxxyHome() };
  const child = spawn(binary, [], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
  });

  writeFileSync(pidFile, String(child.pid));
  child.unref();

  await verifyStarted();
}

async function stopGateway() {
  const os = platform();

  if (os === 'darwin') {
    await stopLaunchd();
  } else if (os === 'linux') {
    await stopSystemd();
  } else {
    await stopFallback();
  }
}

async function stopLaunchd() {
  const plist = plistPath();

  try {
    execSync(`launchctl bootout gui/$(id -u) ${plist}`);
    p.log.success('Gateway stopped.');
  } catch {
    p.log.warn('Gateway service not running or not loaded.');
  }
}

async function stopSystemd() {
  try {
    execSync(`systemctl --user stop ${SYSTEMD_UNIT}`);
    p.log.success('Gateway stopped.');
  } catch {
    p.log.warn('Gateway service not running.');
  }
}

async function stopFallback() {
  const { pidFile } = paths();

  if (!existsSync(pidFile)) {
    p.log.warn('No PID file found. Gateway may not be running.');
    return;
  }

  const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

  try {
    process.kill(pid, 'SIGTERM');
    p.log.success(`Gateway stopped (PID ${pid}).`);
  } catch (err) {
    if (err.code === 'ESRCH') {
      p.log.warn(`Process ${pid} not found. Cleaning up stale PID file.`);
    } else {
      throw err;
    }
  }

  try { unlinkSync(pidFile); } catch { /* already gone */ }
}

async function restartGateway() {
  p.log.step('Stopping gateway...');
  await stopGateway();

  // Brief pause to let the port release
  await new Promise(r => setTimeout(r, 1000));

  p.log.step('Starting gateway...');
  await startGateway();
}

async function gatewayStatus() {
  const os = platform();
  let serviceRunning = false;
  let pid = null;

  if (os === 'darwin') {
    try {
      const out = execSync(`launchctl print gui/$(id -u)/${PLIST_LABEL} 2>/dev/null`, { encoding: 'utf-8' });
      const pidMatch = out.match(/pid\s*=\s*(\d+)/);
      if (pidMatch) {
        pid = pidMatch[1];
        serviceRunning = true;
      }
    } catch { /* not loaded */ }
  } else if (os === 'linux') {
    try {
      execSync(`systemctl --user is-active ${SYSTEMD_UNIT}`, { stdio: 'ignore' });
      serviceRunning = true;
      const out = execSync(`systemctl --user show ${SYSTEMD_UNIT} --property=MainPID`, { encoding: 'utf-8' });
      const pidMatch = out.match(/MainPID=(\d+)/);
      if (pidMatch && pidMatch[1] !== '0') pid = pidMatch[1];
    } catch { /* not active */ }
  }

  // Fallback: check PID file
  if (!serviceRunning) {
    const { pidFile } = paths();
    if (existsSync(pidFile)) {
      pid = readFileSync(pidFile, 'utf-8').trim();
      try {
        process.kill(parseInt(pid, 10), 0);
        serviceRunning = true;
      } catch {
        serviceRunning = false;
        pid = null;
      }
    }
  }

  // Health check
  let healthy = false;
  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  try {
    const resp = await fetch(`${apiUrl}/v1/providers`, { signal: AbortSignal.timeout(2000) });
    if (resp) healthy = true;
  } catch { /* not reachable */ }

  if (serviceRunning) {
    p.log.success(`Gateway is running${pid ? ` (PID ${pid})` : ''}`);
  } else {
    p.log.warn('Gateway is not running.');
  }

  if (healthy) {
    p.log.success(`Health check: reachable at ${apiUrl}`);
  } else {
    p.log.warn(`Health check: not reachable at ${apiUrl}`);
  }

  const binary = findBinary();
  if (binary) {
    p.log.info(`Binary: ${binary}`);
  } else {
    p.log.warn('Binary: not found');
  }
}

async function gatewayLogs() {
  const { logFile } = paths();

  if (!existsSync(logFile)) {
    p.log.warn(`No log file found at ${logFile}`);
    return;
  }

  p.log.info(`Tailing ${logFile} (Ctrl+C to stop)`);

  const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });

  await new Promise((resolve) => {
    process.on('SIGINT', () => {
      tail.kill();
      resolve();
    });
    tail.on('close', resolve);
  });
}

// --- Verify health after start ---

async function verifyStarted() {
  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  let ok = false;

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const resp = await fetch(`${apiUrl}/v1/providers`, { signal: AbortSignal.timeout(1000) });
      if (resp) { ok = true; break; }
    } catch { /* retry */ }
  }

  if (ok) {
    p.log.success(`Gateway started and listening at ${apiUrl}`);
  } else {
    p.log.warn('Gateway process started but health check failed.');
    p.log.info('Check logs with: moxxy gateway logs');
  }
}

// --- Command router ---

export { startGateway, stopGateway, findBinary, paths };

export async function runGateway(client, args) {
  const sub = args[0];

  switch (sub) {
    case 'start':
      await startGateway();
      break;
    case 'stop':
      await stopGateway();
      break;
    case 'restart':
      await restartGateway();
      break;
    case 'status':
      await gatewayStatus();
      break;
    case 'logs':
      await gatewayLogs();
      break;
    default:
      if (!sub && (await import('../ui.js')).isInteractive()) {
        const action = await p.select({
          message: 'Gateway action',
          options: [
            { value: 'start',   label: 'Start',   hint: 'start the gateway' },
            { value: 'stop',    label: 'Stop',     hint: 'stop the gateway' },
            { value: 'restart', label: 'Restart',  hint: 'restart the gateway' },
            { value: 'status',  label: 'Status',   hint: 'show gateway status' },
            { value: 'logs',    label: 'Logs',     hint: 'tail gateway logs' },
          ],
        });
        handleCancel(action);
        await runGateway(client, [action]);
      } else {
        console.error(sub ? `Unknown gateway action: ${sub}` : 'Usage: moxxy gateway <start|stop|restart|status|logs>');
        process.exitCode = 1;
      }
  }
}
