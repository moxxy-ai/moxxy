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

const SYSTEMD_UNIT = 'moxxy-scheduler.service';

function systemdUnitPath(): string {
  return path.join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
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

export const systemdService: ServiceProvider = {
  platform: 'linux',

  async getStatus(): Promise<DaemonServiceStatus> {
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
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    const target = systemdUnitPath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderSystemdUnit(ctx.node, ctx.cli, ctx.log, ctx.home), 'utf8');
    const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    if (reload.status !== 0) {
      return {
        ok: false,
        message: `systemctl --user daemon-reload failed: ${reload.stderr || reload.stdout}`,
        logPath: ctx.log,
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
        logPath: ctx.log,
      };
    }
    return {
      ok: true,
      message:
        `installed systemd user unit ${target} ` +
        '(make sure `loginctl enable-linger ' +
        userInfo().username +
        '` is set so it runs even when logged out)',
      logPath: ctx.log,
    };
  },

  async uninstall(): Promise<UninstallResult> {
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
  },
};
