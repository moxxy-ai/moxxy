import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { launchdService } from './launchd.js';
import { systemdService } from './systemd.js';
import {
  cliBin,
  nodeBin,
  serviceLogPath,
  servicePlatform,
  type ServiceProvider,
  type ServiceResult,
  type ServiceSpec,
  type ServiceStatus,
  type SimpleResult,
} from './common.js';

export {
  cliBin,
  nodeBin,
  serviceLogPath,
  servicePlatform,
  type ServiceProvider,
  type ServiceResult,
  type ServiceSpec,
  type ServiceStatus,
  type SimpleResult,
} from './common.js';

function pickProvider(): ServiceProvider | null {
  if (process.platform === 'darwin') return launchdService;
  if (process.platform === 'linux') return systemdService;
  return null;
}

export async function getServiceStatus(spec: ServiceSpec): Promise<ServiceStatus> {
  const provider = pickProvider();
  if (!provider) {
    return {
      platform: 'unsupported',
      id: spec.id,
      installed: false,
      running: false,
      unitPath: null,
      logPath: serviceLogPath(spec),
    };
  }
  return provider.getStatus(spec);
}

export async function installAndStartService(spec: ServiceSpec): Promise<ServiceResult> {
  const log = serviceLogPath(spec);
  const provider = pickProvider();
  if (!provider) {
    return {
      ok: false,
      message: `unsupported platform: ${process.platform} (only darwin + linux are wired up)`,
      logPath: log,
    };
  }
  const cli = cliBin();
  if (!cli) {
    return {
      ok: false,
      message: 'could not determine the moxxy CLI path (process.argv[1] missing)',
      logPath: log,
    };
  }
  await mkdir(path.dirname(log), { recursive: true });
  return provider.install(spec, { node: nodeBin(), cli, log, home: homedir() });
}

export async function stopAndUninstallService(spec: ServiceSpec): Promise<SimpleResult> {
  const provider = pickProvider();
  if (!provider) return { ok: false, message: `unsupported platform: ${process.platform}` };
  return provider.uninstall(spec);
}

export async function startInstalledService(spec: ServiceSpec): Promise<SimpleResult> {
  const provider = pickProvider();
  if (!provider) return { ok: false, message: `unsupported platform: ${process.platform}` };
  return provider.start(spec);
}

export async function stopRunningService(spec: ServiceSpec): Promise<SimpleResult> {
  const provider = pickProvider();
  if (!provider) return { ok: false, message: `unsupported platform: ${process.platform}` };
  return provider.stop(spec);
}

/** Tail the service's log file. Returns '' if it doesn't exist yet. */
export async function readServiceLog(spec: Pick<ServiceSpec, 'id'>, lines: number): Promise<string> {
  try {
    const text = await readFile(serviceLogPath(spec), 'utf8');
    const all = text.split('\n');
    return all.slice(Math.max(0, all.length - lines)).join('\n');
  } catch {
    return '';
  }
}
