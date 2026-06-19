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

function label(spec: Pick<ServiceSpec, 'id'>): string {
  return `com.moxxy.${spec.id}`;
}

function plistPath(spec: Pick<ServiceSpec, 'id'>): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${label(spec)}.plist`);
}

function escapeXml(value: string): string {
  // Escape all five XML metacharacters (incl. the single quote) so the helper
  // is safe in attribute contexts too, not just element content — values like
  // `serve --except <list>` are user-influenced and the contract shouldn't be
  // "only ever used between tags".
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderPlist(spec: ServiceSpec, ctx: InstallContext): string {
  // ProgramArguments must be a flat list of strings — the equivalent of
  // argv. RunAtLoad=true fires on every login; KeepAlive=true restarts
  // on crash. PATH is set explicitly because launchd's env is
  // intentionally bare — child processes spawned from within node
  // need at least the standard bin dirs.
  const programArgs = [ctx.node, ctx.cli, ...spec.execArgs]
    .map((s) => `    <string>${escapeXml(s)}</string>`)
    .join('\n');
  const envEntries: Array<[string, string]> = [
    ['PATH', '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'],
    ...Object.entries(spec.env ?? {}),
  ];
  const envBlock = envEntries
    .map(([k, v]) => `    <key>${escapeXml(k)}</key>\n    <string>${escapeXml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label(spec))}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(ctx.home)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(ctx.log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(ctx.log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envBlock}
  </dict>
</dict>
</plist>
`;
}

function domain(): string {
  return `gui/${userInfo().uid}`;
}

export const launchdService: ServiceProvider = {
  platform: 'darwin',

  async getStatus(spec): Promise<ServiceStatus> {
    const target = plistPath(spec);
    const installed = await fileExists(target);
    let running = false;
    if (installed) {
      const result = spawnSync('launchctl', ['print', `${domain()}/${label(spec)}`], {
        encoding: 'utf8',
        timeout: 5000,
      });
      running = result.status === 0;
    }
    return {
      platform: 'darwin',
      id: spec.id,
      installed,
      running,
      unitPath: target,
      logPath: serviceLogPath(spec),
    };
  },

  async install(spec, ctx): Promise<ServiceResult> {
    const target = plistPath(spec);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderPlist(spec, ctx), 'utf8');
    // bootout first in case a stale instance is loaded; ignore failure
    // (will just mean nothing was loaded). Then bootstrap the fresh plist.
    spawnSync('launchctl', ['bootout', `${domain()}/${label(spec)}`], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const load = spawnSync('launchctl', ['bootstrap', domain(), target], {
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
    return { ok: true, message: `installed launchd unit ${target}`, logPath: ctx.log };
  },

  async uninstall(spec): Promise<SimpleResult> {
    const target = plistPath(spec);
    if (!(await fileExists(target))) {
      return { ok: true, message: 'no launchd unit installed' };
    }
    spawnSync('launchctl', ['bootout', `${domain()}/${label(spec)}`], {
      encoding: 'utf8',
      timeout: 5000,
    });
    await unlink(target).catch(() => undefined);
    return { ok: true, message: `removed ${target}` };
  },

  async start(spec): Promise<SimpleResult> {
    if (!(await fileExists(plistPath(spec)))) {
      return { ok: false, message: 'service not installed — run `moxxy service install` first' };
    }
    const r = spawnSync('launchctl', ['kickstart', '-k', `${domain()}/${label(spec)}`], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) return { ok: false, message: `launchctl kickstart failed: ${r.stderr || r.stdout}` };
    return { ok: true, message: 'started' };
  },

  async stop(spec): Promise<SimpleResult> {
    if (!(await fileExists(plistPath(spec)))) {
      return { ok: false, message: 'service not installed' };
    }
    // SIGTERM gives the process a chance to flush. KeepAlive=true means
    // launchd will restart it — `service uninstall` is the way to stop
    // permanently.
    spawnSync('launchctl', ['kill', 'SIGTERM', `${domain()}/${label(spec)}`], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return { ok: true, message: 'stop signal sent (KeepAlive may restart it — uninstall to stop permanently)' };
  },
};
