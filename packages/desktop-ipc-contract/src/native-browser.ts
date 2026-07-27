export type NativeBrowserBackend = 'native' | 'playwright';

export interface NativeBrowserTabSnapshot {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly zoom: number;
}

export interface NativeBrowserSnapshot {
  readonly backend: NativeBrowserBackend;
  readonly workspaceId: string;
  readonly tabs: ReadonlyArray<NativeBrowserTabSnapshot>;
  readonly activeTabId: string;
  readonly visible: boolean;
  /** Present only while an agent-owned browser action is in flight. This is
   * runtime UI state and is never persisted with the browser profile. */
  readonly agentControl?: {
    readonly action: string;
    readonly startedAtMs: number;
  };
  /** A third-party origin is waiting for a user decision. Agent actions can
   * observe this state, but only the trusted desktop renderer can resolve it. */
  readonly permissionRequest?: NativeBrowserPermissionRequest;
  /** Downloads started by pages in this workspace. Terminal rows remain
   * visible for the lifetime of the desktop process. */
  readonly downloads?: ReadonlyArray<NativeBrowserDownload>;
}

export type NativeBrowserSitePermission =
  | 'microphone'
  | 'camera'
  | 'microphone-camera'
  | 'geolocation'
  | 'clipboard';

export interface NativeBrowserPermissionRequest {
  readonly id: string;
  readonly tabId: string;
  readonly origin: string;
  readonly permission: NativeBrowserSitePermission;
}

export interface NativeBrowserDownload {
  readonly id: string;
  readonly tabId: string;
  readonly filename: string;
  readonly state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly savePath: string;
}

export interface NativeBrowserAvailability {
  readonly backend: NativeBrowserBackend;
  readonly available: boolean;
  readonly reason?: string;
}

export interface NativeBrowserRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeBrowserViewport {
  readonly width: number;
  readonly height: number;
}

export interface NativeBrowserCapture {
  readonly mediaType: 'image/png';
  readonly base64: string;
}
