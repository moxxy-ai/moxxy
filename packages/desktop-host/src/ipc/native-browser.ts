import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';

import type { NativeBrowserController } from '../native-browser-controller.js';
import { handle, setActiveBus } from './shared.js';

/** Register the native browser only on the local Electron bus. Deliberately
 * separate from registerIpcHandlers(), whose sweep also targets WebSocket and
 * mobile transports. */
export function registerNativeBrowserIpc(
  bus: CommandBus,
  controller: NativeBrowserController,
): void {
  setActiveBus(bus);
  handle('nativeBrowser.status', () => controller.status());
  handle('nativeBrowser.open', (args) => controller.open(args));
  handle('nativeBrowser.setVisible', (args) => controller.setVisible(args));
  handle('nativeBrowser.setBounds', (args) => controller.setBounds(args));
  handle('nativeBrowser.navigate', (args) => controller.navigate(args));
  handle('nativeBrowser.back', (args) => controller.back(args));
  handle('nativeBrowser.forward', (args) => controller.forward(args));
  handle('nativeBrowser.reload', (args) => controller.reload(args));
  handle('nativeBrowser.setZoom', (args) => controller.setZoom(args));
  handle('nativeBrowser.newTab', (args) => controller.newTab(args));
  handle('nativeBrowser.selectTab', (args) => controller.selectTab(args));
  handle('nativeBrowser.closeTab', (args) => controller.closeTab(args));
  handle('nativeBrowser.beginCapture', (args) => controller.beginCapture(args));
  handle('nativeBrowser.endCapture', (args) => controller.endCapture(args));
  handle('nativeBrowser.stopAgentControl', (args) => controller.stopAgentControl(args));
  handle('nativeBrowser.resolvePermission', (args) => controller.resolvePermission(args));
  handle('nativeBrowser.cancelDownload', (args) => controller.cancelDownload(args));
}
