import {
  getServiceStatus,
  installAndStartService,
  serviceLogPath,
  stopAndUninstallService,
  type ServiceSpec,
} from './service/index.js';

/**
 * Back-compat shim — the scheduler daemon rides on the generic
 * service-manager primitives so it shares unit-rendering, log paths,
 * and launchd/systemd plumbing with the other channel services that
 * `moxxy service` can install.
 */

export const SCHEDULER_SERVICE: ServiceSpec = {
  id: 'scheduler',
  description: 'moxxy scheduler — fires time-driven prompts',
  execArgs: ['schedule', 'daemon'],
};

export interface DaemonServiceStatus {
  readonly platform: 'darwin' | 'linux' | 'unsupported';
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string | null;
}

export async function getDaemonStatus(): Promise<DaemonServiceStatus> {
  const s = await getServiceStatus(SCHEDULER_SERVICE);
  return {
    platform: s.platform,
    installed: s.installed,
    running: s.running,
    unitPath: s.unitPath,
    logPath: s.platform === 'unsupported' ? null : s.logPath,
  };
}

export async function installAndStartDaemon(): Promise<{ ok: boolean; message: string; logPath: string }> {
  return installAndStartService(SCHEDULER_SERVICE);
}

export async function stopAndUninstallDaemon(): Promise<{ ok: boolean; message: string }> {
  return stopAndUninstallService(SCHEDULER_SERVICE);
}

export function schedulerLogPath(): string {
  return serviceLogPath(SCHEDULER_SERVICE);
}
