import { fileURLToPath } from 'node:url';
import type { PlatformProfile } from '../backend/backend.js';
import { CONTRACT_PROTOCOL_VERSION } from '../backend/rpc.js';
import { verifyHelperArtifact } from '../helper/artifact.js';

/** The universal helper built by `native/macos/build.sh`. */
export const macosHelperPath = fileURLToPath(new URL('../../bin/darwin-universal/moxxy-computer', import.meta.url));

export const macosProfile: PlatformProfile = {
  platform: 'darwin',
  protocolVersion: CONTRACT_PROTOCOL_VERSION,
  helperPath: macosHelperPath,
  helperArgs: [],
  verifyHelper: () => verifyHelperArtifact(macosHelperPath, CONTRACT_PROTOCOL_VERSION),
  unavailableMessage: 'The macOS Computer Use helper is missing or does not match this version. Reinstall Moxxy; chat remains available.',
  // Launching an app and letting it settle can take several seconds on its own.
  timeoutMs: 30_000,
};
