import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  cliBin,
  logPath,
  nodeBin,
  type DaemonServiceStatus,
  type ServiceProvider,
} from './service/common.js';
import { launchdService } from './service/launchd.js';
import { systemdService } from './service/systemd.js';

export type { DaemonServiceStatus } from './service/common.js';

/**
 * OS-level daemonization for `moxxy schedule daemon`. Picks the right
 * per-platform implementation (`launchd.ts` on macOS, `systemd.ts` on
 * Linux) and exposes three verbs — install (start), stop (unload +
 * remove), status (query).
 */

function pickProvider(): ServiceProvider | null {
  if (process.platform === 'darwin') return launchdService;
  if (process.platform === 'linux') return systemdService;
  return null;
}

export async function getDaemonStatus(): Promise<DaemonServiceStatus> {
  const provider = pickProvider();
  if (!provider) {
    return { platform: 'unsupported', installed: false, running: false, unitPath: null, logPath: null };
  }
  return provider.getStatus();
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

  const provider = pickProvider();
  if (!provider) {
    return {
      ok: false,
      message: `unsupported platform: ${process.platform} (only darwin + linux are wired up)`,
      logPath: log,
    };
  }
  return provider.install({ node, cli, log, home });
}

export async function stopAndUninstallDaemon(): Promise<{ ok: boolean; message: string }> {
  const provider = pickProvider();
  if (!provider) return { ok: false, message: `unsupported platform: ${process.platform}` };
  return provider.uninstall();
}
