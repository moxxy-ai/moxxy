import { definePlugin } from '@moxxy/sdk';
import { buildTerminalSurface, buildTerminalTool, closeAllTerminals } from './terminal.js';

export {
  buildTerminalSurface,
  buildTerminalTool,
  closeAllTerminals,
} from './terminal.js';
export { createTerminalProcess, type TerminalProcess } from './pty.js';

export function buildTerminalPlugin() {
  return definePlugin({
    name: '@moxxy/plugin-terminal',
    version: '0.0.0',
    surfaces: [buildTerminalSurface()],
    tools: [buildTerminalTool()],
    hooks: {
      onShutdown: () => {
        // Kill the shared shell(s) with the session so no orphan PTY lingers.
        closeAllTerminals();
      },
    },
  });
}

export const terminalPlugin = buildTerminalPlugin();

export default terminalPlugin;
