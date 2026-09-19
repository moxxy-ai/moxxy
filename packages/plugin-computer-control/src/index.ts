import { definePlugin, defineTool, z, type Plugin, type ToolDef } from '@moxxy/sdk';
import { WindowsBackend } from './windows/backend.js';
import { IS_DARWIN } from './shell.js';
import { applescriptTool } from './tools/applescript.js';
import { clickTool } from './tools/click.js';
import { clipboardTool } from './tools/clipboard.js';
import { keyTool } from './tools/key.js';
import { openTool } from './tools/open.js';
import { screenshotTool } from './tools/screenshot.js';
import { typeTool } from './tools/type.js';

export {
  applescriptTool,
  clickTool,
  clipboardTool,
  keyTool,
  openTool,
  screenshotTool,
  typeTool,
};

export const computerControlTools: ReadonlyArray<ToolDef> = [
  screenshotTool,
  clickTool,
  typeTool,
  keyTool,
  openTool,
  clipboardTool,
  applescriptTool,
];

/**
 * `@moxxy/plugin-computer-control` — programmatic control of the host
 * computer (mouse, keyboard, screenshot, clipboard, app launching,
 * AppleScript escape hatch).
 *
 * macOS retains its system-binary backend; Windows x64 uses our bundled
 * native helper. Unsupported hosts expose status only.
 *
 * Every tool is `permission: 'prompt'`. There is intentionally no
 * "allow always" shortcut for these — granting blanket permission to
 * drive the user's screen + keyboard is exactly the wrong default.
 */
export function createComputerControlPlugin(platform: NodeJS.Platform = process.platform, arch: string = process.arch): Plugin {
  const backend = platform === 'win32' && arch === 'x64' ? new WindowsBackend() : undefined;
  const status = defineTool({
    name: 'computer_status', description: 'Report Computer Use platform capabilities and limitations.',
    inputSchema: z.object({}).strict(), permission: { action: 'prompt' },
    handler: () => ({ platform, architecture: arch, ready: platform === 'darwin',
      limitations: platform === 'darwin' ? ['Requires Screen Recording and Accessibility permissions'] : ['Unsupported platform or architecture'] }),
  });
  return definePlugin({
    name: '@moxxy/plugin-computer-control', version: '0.0.0',
    tools: backend ? backend.tools() : platform === 'darwin' ? [...computerControlTools, status] : [status],
    ...(backend ? { hooks: backend.hooks } : {}),
  });
}

export const computerControlPlugin = createComputerControlPlugin();

export default computerControlPlugin;

// Re-export for callers that want a runtime gate.
export { IS_DARWIN };
