import { definePlugin, defineTool, z, type Plugin } from '@moxxy/sdk';
import { ComputerBackend, type PlatformProfile } from './backend/backend.js';
import { helperProblem } from './helper/artifact.js';
import { linuxProfile } from './linux/profile.js';
import { macosProfile } from './macos/profile.js';
import { windowsProfile } from './windows/profile.js';

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

function profileFor(platform: NodeJS.Platform, arch: string): PlatformProfile | undefined {
  if (platform === 'darwin') return macosProfile;
  if (platform === 'linux') return arch === 'x64' || arch === 'arm64' ? linuxProfile(arch) : undefined;
  return platform === 'win32' && arch === 'x64' ? windowsProfile : undefined;
}

/**
 * `@moxxy/plugin-computer-control` — operates the user's desktop applications
 * through a bundled native helper: macOS (universal), Windows x64 and Linux
 * (x64, arm64; X11 sessions). Other
 * hosts, and a host whose helper is missing, expose `computer_status` only.
 *
 * Every tool is `permission: 'prompt'`; which apps may be controlled, and how
 * far, is a separate grant recorded in the session log.
 */
export function createComputerControlPlugin(
  platform: NodeJS.Platform = process.platform, arch: string = process.arch, profile: PlatformProfile | undefined = profileFor(platform, arch),
): Plugin {
  if (!profile) return statusOnly(platform, arch, 'Unsupported platform or architecture');
  const problem = helperProblem(profile.helperPath, profile.protocolVersion);
  if (problem) return statusOnly(platform, arch, `${problem} ${profile.unavailableMessage}`);
  const backend = new ComputerBackend(profile);
  return definePlugin({ name, version: '0.0.0', tools: backend.tools(), hooks: backend.hooks, surfaces: backend.surfaces() });
}

export const computerControlPlugin = createComputerControlPlugin();

export default computerControlPlugin;
