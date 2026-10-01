import { fileURLToPath } from 'node:url';
import type { PlatformProfile } from '../backend/backend.js';
import { CONTRACT_PROTOCOL_VERSION } from '../backend/rpc.js';
import { verifyHelperArtifact } from '../helper/artifact.js';

/** The x64 helper built by `native/Build-Windows.ps1`. */
export const windowsHelperPath = fileURLToPath(new URL('../../bin/win32-x64/moxxy-computer.exe', import.meta.url));

export const windowsProfile: PlatformProfile = {
  platform: 'win32',
  protocolVersion: CONTRACT_PROTOCOL_VERSION,
  helperPath: windowsHelperPath,
  helperArgs: [],
  verifyHelper: () => verifyHelperArtifact(windowsHelperPath, CONTRACT_PROTOCOL_VERSION),
  unavailableMessage: 'The Windows Computer Use helper is missing or does not match this version. Install the matching x64 build from a full installer; chat remains available.',
  // Launching an app and letting it settle can take several seconds on its own.
  timeoutMs: 30_000,
};
