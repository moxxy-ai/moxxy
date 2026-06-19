import { mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { launchdService } from './launchd.js';
import { systemdService } from './systemd.js';
import {
  cliBin,
  nodeBin,
  serviceLogPath,
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

/**
 * Hard cap on how many trailing bytes a tail will ever buffer, regardless of
 * the requested line count. Service logs are never rotated (launchd/systemd
 * append to one file forever) so a crash-looping daemon can grow the log to
 * hundreds of MB / GB; reading the whole thing to show 40 lines can OOM the
 * CLI exactly when the user is debugging the crash. We read at most this many
 * bytes from the end of the file.
 */
const MAX_TAIL_BYTES = 256 * 1024;
/** Heuristic bytes-per-line budget used to size the trailing read. */
const TAIL_BYTES_PER_LINE = 512;

/**
 * Tail the service's log file by reading only the trailing bytes (never the
 * whole, unbounded, never-rotated file). Returns '' if it doesn't exist yet.
 */
export async function readServiceLog(spec: Pick<ServiceSpec, 'id'>, lines: number): Promise<string> {
  const logPath = serviceLogPath(spec);
  const safeLines = Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 1;
  const handle = await open(logPath, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const { size } = await handle.stat();
    // Size the read by the requested line count, but never exceed the cap.
    const want = Math.min(MAX_TAIL_BYTES, Math.max(safeLines * TAIL_BYTES_PER_LINE, TAIL_BYTES_PER_LINE));
    if (size <= want) {
      // Small file (or the whole file fits under the cap): read it all.
      const text = await readFile(logPath, 'utf8').catch(() => '');
      const all = text.split('\n');
      return all.slice(Math.max(0, all.length - safeLines)).join('\n');
    }
    const start = size - want;
    const buf = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buf, 0, want, start);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    // The read almost certainly began mid-line; drop the first (partial) line.
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    const all = text.split('\n');
    return all.slice(Math.max(0, all.length - safeLines)).join('\n');
  } catch {
    return '';
  } finally {
    await handle.close().catch(() => undefined);
  }
}
