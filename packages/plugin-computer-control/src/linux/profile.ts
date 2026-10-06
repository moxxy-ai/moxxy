import { fileURLToPath } from 'node:url';
import type { PlatformProfile } from '../backend/backend.js';
import { CONTRACT_PROTOCOL_VERSION } from '../backend/rpc.js';
import { verifyHelperArtifact } from '../helper/artifact.js';

export type LinuxArchitecture = 'x64' | 'arm64';

/** The helper built by `native/linux/build.sh` for one architecture. */
export const linuxHelperPath = (arch: LinuxArchitecture) => fileURLToPath(new URL(`../../bin/linux-${arch}/moxxy-computer`, import.meta.url));

export function linuxProfile(arch: LinuxArchitecture): PlatformProfile {
  const helperPath = linuxHelperPath(arch);
  return {
    platform: 'linux',
    protocolVersion: CONTRACT_PROTOCOL_VERSION,
    helperPath,
    helperArgs: [],
    verifyHelper: () => verifyHelperArtifact(helperPath, CONTRACT_PROTOCOL_VERSION),
    unavailableMessage: 'The Linux Computer Use helper is missing or does not match this version. Reinstall Moxxy; chat remains available.',
    // Launching an app and letting it settle can take several seconds on its own.
    timeoutMs: 30_000,
    // The helper sends pictures; it has no video encoder.
    previewCodecs: ['jpeg'],
  };
}
