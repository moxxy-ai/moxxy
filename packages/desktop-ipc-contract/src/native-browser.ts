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
