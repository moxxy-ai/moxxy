import { spawnSync } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

/**
 * OS-level daemonization for `moxxy schedule daemon`. We expose three
 * verbs — install (start), stop (unload + remove), status (query). The
 * concrete unit format differs by platform:
 *
 *   - macOS: launchd `LaunchAgent` plist at
 *     `~/Library/LaunchAgents/com.moxxy.scheduler.plist`
 *   - Linux: systemd user unit at
 *     `~/.config/systemd/user/moxxy-scheduler.service`
 *
 * Both keep the daemon alive across logouts/restarts and write
 * stdout/stderr to `~/.moxxy/scheduler-daemon.log`. The unit's
 * `ExecStart` points at the node binary + the path to this CLI's
 * `bin.js` (resolved from `process.argv[1]` at install time), invoked
 * as `schedule daemon` (i.e. the foreground form), so a single
 * implementation runs whether you launch it interactively or via the
 * OS supervisor.
 */

export interface DaemonServiceStatus {
  readonly platform: 'darwin' | 'linux' | 'unsupported';
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string | null;
}

const LABEL = 'com.moxxy.scheduler';
const SYSTEMD_UNIT = 'moxxy-scheduler.service';

function logPath(): string {
  return path.join(process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy'), 'scheduler-daemon.log');
}

function plistPath(): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function systemdUnitPath(): string {
  return path.join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
}

function nodeBin(): string {
  // process.execPath gives the absolute path to the running Node
  // binary, which is what we want — pnpm-installed `moxxy` is also
  // launched via Node, and the user's PATH may not contain a Node at
  // the same path systemd will see.
  return process.execPath;
}

function cliBin(): string {
  // argv[1] is the resolved path to the JS entry that's currently
  // running — i.e. /…/packages/cli/dist/bin.js or wherever pnpm
  // linked it. Using it as the ExecStart target means the daemon
  // tracks whatever binary the user installed.
  return process.argv[1] ?? '';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPlist(node: string, cli: string, log: string, home: string): string {
  // ProgramArguments must be a flat list of strings — the equivalent
  // of argv. RunAtLoad=true fires on every login; KeepAlive=true
  // restarts on crash. StandardOut/Error redirect to a single log
  // file for "tail -f" debugging.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(node)}</string>
    <string>${escapeXml(cli)}</string>
    <string>schedule</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(home)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

function renderSystemdUnit(node: string, cli: string, log: string, home: string): string {
  return `[Unit]
Description=moxxy scheduler — fires time-driven prompts
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${node} ${cli} schedule daemon
WorkingDirectory=${home}
Restart=on-failure
RestartSec=10
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`;
}

function platform(): DaemonServiceStatus['platform'] {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

export async function getDaemonStatus(): Promise<DaemonServiceStatus> {
  const p = platform();
  if (p === 'darwin') {
    const installed = await fileExists(plistPath());
    let running = false;
    if (installed) {
      const uid = userInfo().uid;
      const result = spawnSync('launchctl', ['print', `gui/${uid}/${LABEL}`], {
        encoding: 'utf8',
        timeout: 5000,
      });
      running = result.status === 0;
    }
    return {
      platform: 'darwin',
      installed,
      running,
      unitPath: plistPath(),
      logPath: logPath(),
    };
  }
  if (p === 'linux') {
    const installed = await fileExists(systemdUnitPath());
    let running = false;
    if (installed) {
      const result = spawnSync('systemctl', ['--user', 'is-active', SYSTEMD_UNIT], {
        encoding: 'utf8',
        timeout: 5000,
      });
      running = result.stdout.trim() === 'active';
    }
    return {
      platform: 'linux',
      installed,
      running,
      unitPath: systemdUnitPath(),
      logPath: logPath(),
    };
  }
  return { platform: 'unsupported', installed: false, running: false, unitPath: null, logPath: null };
}

export async function installAndStartDaemon(): Promise<{ ok: boolean; message: string; logPath: string }> {
  const node = nodeBin();
  const cli = cliBin();
  const log = logPath();
  const home = homedir();
  if (!cli) {
    return {
      ok: false,
      message: 'could not determine the moxxy CLI path (process.argv[1] missing)',
      logPath: log,
    };
  }
  await mkdir(path.dirname(log), { recursive: true });

  if (process.platform === 'darwin') {
    const target = plistPath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderPlist(node, cli, log, home), 'utf8');
    const uid = userInfo().uid;
    // `bootout` first in case a stale instance is loaded; ignore
    // failure (will just mean nothing was loaded). Then `bootstrap`
    // the fresh plist into the user's GUI domain.
    spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { encoding: 'utf8', timeout: 5000 });
    const load = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, target], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (load.status !== 0) {
      return {
        ok: false,
        message: `launchctl bootstrap failed: ${load.stderr || load.stdout || 'unknown error'}`,
        logPath: log,
      };
    }
    return {
      ok: true,
      message: `installed launchd unit ${target}`,
      logPath: log,
    };
  }

  if (process.platform === 'linux') {
    const target = systemdUnitPath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderSystemdUnit(node, cli, log, home), 'utf8');
    const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    if (reload.status !== 0) {
      return {
        ok: false,
        message: `systemctl --user daemon-reload failed: ${reload.stderr || reload.stdout}`,
        logPath: log,
      };
    }
    const enable = spawnSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (enable.status !== 0) {
      return {
        ok: false,
        message: `systemctl --user enable --now failed: ${enable.stderr || enable.stdout}`,
        logPath: log,
      };
    }
    return {
      ok: true,
      message:
        `installed systemd user unit ${target} ` +
        '(make sure `loginctl enable-linger ' +
        userInfo().username +
        '` is set so it runs even when logged out)',
      logPath: log,
    };
  }

  return {
    ok: false,
    message: `unsupported platform: ${process.platform} (only darwin + linux are wired up)`,
    logPath: log,
  };
}

export async function stopAndUninstallDaemon(): Promise<{ ok: boolean; message: string }> {
  if (process.platform === 'darwin') {
    const target = plistPath();
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no launchd unit installed' };
    }
    const uid = userInfo().uid;
    spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { encoding: 'utf8', timeout: 5000 });
    await unlink(target).catch(() => undefined);
    return { ok: true, message: `removed ${target}` };
  }
  if (process.platform === 'linux') {
    const target = systemdUnitPath();
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no systemd unit installed' };
    }
    spawnSync('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT], {
      encoding: 'utf8',
      timeout: 10000,
    });
    await unlink(target).catch(() => undefined);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    return { ok: true, message: `removed ${target}` };
  }
  return { ok: false, message: `unsupported platform: ${process.platform}` };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}
