import { spawnSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import {
  fileExists,
  serviceLogPath,
  type InstallContext,
  type ServiceProvider,
  type ServiceResult,
  type ServiceSpec,
  type ServiceStatus,
  type SimpleResult,
} from './common.js';

function unitName(spec: Pick<ServiceSpec, 'id'>): string {
  return `moxxy-${spec.id}.service`;
}

function unitPath(spec: Pick<ServiceSpec, 'id'>): string {
  return path.join(homedir(), '.config', 'systemd', 'user', unitName(spec));
}

export function renderUnit(spec: ServiceSpec, ctx: InstallContext): string {
  const execStart = [ctx.node, ctx.cli, ...spec.execArgs].map(quote).join(' ');
  const envLines = Object.entries(spec.env ?? {})
    .map(([k, v]) => `Environment=${k}=${envValue(v)}`)
    .join('\n');
  return `[Unit]
Description=${spec.description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${ctx.home}
Restart=on-failure
RestartSec=10
StandardOutput=append:${ctx.log}
StandardError=append:${ctx.log}
${envLines}

[Install]
WantedBy=default.target
`;
}

function quote(s: string): string {
  // systemd ExecStart tokenizes unquoted args; quote only when needed.
  if (!/[\s"]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

/**
 * Quote an `Environment=` value. systemd splits the directive on whitespace and
 * treats `"`/`\` specially, so a value with a space or quote would otherwise
 * split into multiple (wrong) vars. Mirror the ExecStart `quote()` symmetry:
 * double-quote and escape embedded backslashes/quotes only when needed. A
 * newline can't live on a single unit line at all, so strip CR/LF rather than
 * emit a broken directive.
 */
function envValue(v: string): string {
  const s = v.replace(/[\r\n]+/g, ' ');
  if (!/[\s"\\]/.test(s)) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export const systemdService: ServiceProvider = {
  platform: 'linux',

  async getStatus(spec): Promise<ServiceStatus> {
    const target = unitPath(spec);
    const installed = await fileExists(target);
    let running = false;
    if (installed) {
      const result = spawnSync('systemctl', ['--user', 'is-active', unitName(spec)], {
        encoding: 'utf8',
        timeout: 5000,
      });
      running = result.stdout.trim() === 'active';
    }
    return {
      platform: 'linux',
      id: spec.id,
      installed,
      running,
      unitPath: target,
      logPath: serviceLogPath(spec),
    };
  },

  async install(spec, ctx): Promise<ServiceResult> {
    const target = unitPath(spec);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderUnit(spec, ctx), 'utf8');
    const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    if (reload.status !== 0) {
      return {
        ok: false,
        message: `systemctl --user daemon-reload failed: ${reload.stderr || reload.stdout}`,
        logPath: ctx.log,
      };
    }
    const enable = spawnSync('systemctl', ['--user', 'enable', '--now', unitName(spec)], {
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
        `installed systemd user unit ${target}  ` +
        '(run `loginctl enable-linger ' +
        userInfo().username +
        '` once so the service survives logout)',
      logPath: ctx.log,
    };
  },

  async uninstall(spec): Promise<SimpleResult> {
    const target = unitPath(spec);
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no systemd unit installed' };
    }
    spawnSync('systemctl', ['--user', 'disable', '--now', unitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    await unlink(target).catch(() => undefined);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8', timeout: 5000 });
    return { ok: true, message: `removed ${target}` };
  },

  async start(spec): Promise<SimpleResult> {
    if (!(await fileExists(unitPath(spec)))) {
      return { ok: false, message: 'service not installed — run `moxxy service install` first' };
    }
    const r = spawnSync('systemctl', ['--user', 'start', unitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) return { ok: false, message: `systemctl start failed: ${r.stderr || r.stdout}` };
    return { ok: true, message: 'started' };
  },

  async stop(spec): Promise<SimpleResult> {
    if (!(await fileExists(unitPath(spec)))) {
      return { ok: false, message: 'service not installed' };
    }
    const r = spawnSync('systemctl', ['--user', 'stop', unitName(spec)], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) return { ok: false, message: `systemctl stop failed: ${r.stderr || r.stdout}` };
    return { ok: true, message: 'stopped' };
  },
};
