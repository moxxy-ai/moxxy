import type {
  NativeBrowserAvailability,
  NativeBrowserCapture,
  NativeBrowserRect,
  NativeBrowserSnapshot,
  NativeBrowserViewport,
} from '@moxxy/desktop-ipc-contract';
import type { NativeBrowserAgentAction } from './native-browser-bridge.js';

/** Electron-only browser boundary. The implementation lives in the desktop
 * app, while the host owns the typed IPC registration without importing an
 * Electron WebContentsView into transport-neutral code. */
export interface NativeBrowserController {
  status(): Promise<NativeBrowserAvailability>;
  open(args: { workspaceId: string }): Promise<NativeBrowserSnapshot>;
  setVisible(args: { workspaceId: string; visible: boolean }): Promise<void>;
  setBounds(args: {
    workspaceId: string;
    rect: NativeBrowserRect;
    rendererViewport: NativeBrowserViewport;
  }): Promise<void>;
  navigate(args: { workspaceId: string; url: string; tabId?: string }): Promise<void>;
  back(args: { workspaceId: string; tabId?: string }): Promise<void>;
  forward(args: { workspaceId: string; tabId?: string }): Promise<void>;
  reload(args: { workspaceId: string; tabId?: string }): Promise<void>;
  setZoom(args: { workspaceId: string; tabId?: string; zoom: number }): Promise<void>;
  newTab(args: { workspaceId: string; url?: string }): Promise<NativeBrowserSnapshot>;
  selectTab(args: { workspaceId: string; tabId: string }): Promise<NativeBrowserSnapshot>;
  closeTab(args: { workspaceId: string; tabId: string }): Promise<NativeBrowserSnapshot>;
  beginCapture(args: { workspaceId: string; tabId?: string }): Promise<NativeBrowserCapture>;
  endCapture(args: {
    workspaceId: string;
    tabId?: string;
    rect?: NativeBrowserRect;
  }): Promise<NativeBrowserCapture | null>;
  stopAgentControl(args: { workspaceId: string }): Promise<void>;
  resolvePermission(args: {
    workspaceId: string;
    requestId: string;
    allow: boolean;
  }): Promise<void>;
  cancelDownload(args: { workspaceId: string; downloadId: string }): Promise<void>;
  executeAgentAction(
    workspaceId: string,
    action: NativeBrowserAgentAction,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
