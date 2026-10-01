import { definePlugin, defineTool, z, type Plugin } from '@moxxy/sdk';
import { ComputerBackend, type PlatformProfile } from './backend/backend.js';
import { helperProblem } from './helper/artifact.js';
import { macosProfile } from './macos/profile.js';
import { WindowsBackend } from './windows/backend.js';

const name = '@moxxy/plugin-computer-control';

/** The only tool of a host that cannot run Computer Use: it says why. */
function statusOnly(platform: NodeJS.Platform, architecture: string, limitation: string): Plugin {
  const status = defineTool({
    name: 'computer_status', description: 'Report Computer Use platform capabilities and limitations.',
    inputSchema: z.object({}).strict(), permission: { action: 'prompt' },
    handler: () => ({ platform, architecture, ready: false, limitations: [limitation] }),
  });
  return definePlugin({ name, version: '0.0.0', tools: [status] });
}

/**
 * `@moxxy/plugin-computer-control` — operates the user's desktop applications
 * through a bundled native helper: macOS (universal) and Windows x64. Other
 * hosts, and a host whose helper is missing, expose `computer_status` only.
 *
 * Every tool is `permission: 'prompt'`; which apps may be controlled, and how
 * far, is a separate grant recorded in the session log.
 */
export function createComputerControlPlugin(
  platform: NodeJS.Platform = process.platform, arch: string = process.arch, macos: PlatformProfile = macosProfile,
): Plugin {
  if (platform === 'win32' && arch === 'x64') {
    const backend = new WindowsBackend();
    return definePlugin({ name, version: '0.0.0', tools: backend.tools(), hooks: backend.hooks });
  }
  if (platform !== 'darwin') return statusOnly(platform, arch, 'Unsupported platform or architecture');
  const problem = helperProblem(macos.helperPath, macos.protocolVersion);
  if (problem) return statusOnly(platform, arch, `${problem} ${macos.unavailableMessage}`);
  const backend = new ComputerBackend(macos);
  return definePlugin({ name, version: '0.0.0', tools: backend.tools(), hooks: backend.hooks, surfaces: backend.surfaces() });
}

export const computerControlPlugin = createComputerControlPlugin();

export default computerControlPlugin;
