import { spawnSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import {
  fileExists,
  logPath,
  type DaemonServiceStatus,
  type InstallContext,
  type InstallResult,
  type ServiceProvider,
  type UninstallResult,
} from './common.js';

const LABEL = 'com.moxxy.scheduler';

function plistPath(): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
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

export const launchdService: ServiceProvider = {
  platform: 'darwin',

  async getStatus(): Promise<DaemonServiceStatus> {
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
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    const target = plistPath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderPlist(ctx.node, ctx.cli, ctx.log, ctx.home), 'utf8');
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
        logPath: ctx.log,
      };
    }
    return {
      ok: true,
      message: `installed launchd unit ${target}`,
      logPath: ctx.log,
    };
  },

  async uninstall(): Promise<UninstallResult> {
    const target = plistPath();
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no launchd unit installed' };
    }
    const uid = userInfo().uid;
    spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { encoding: 'utf8', timeout: 5000 });
    await unlink(target).catch(() => undefined);
    return { ok: true, message: `removed ${target}` };
  },
};
