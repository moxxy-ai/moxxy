export type BrowserKind = 'chromium' | 'firefox' | 'webkit';

export type ErrorKind = 'init' | 'navigation' | 'runtime' | 'timeout' | 'unknown';

export interface Req {
  readonly id: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface Ok {
  readonly id: string;
  readonly ok: true;
  readonly result?: unknown;
  /** One-shot human-readable note (e.g. "Auto-installed Chromium"). */
  readonly notice?: string;
}

export interface Err {
  readonly id: string;
  readonly ok: false;
  readonly error: { message: string; kind: ErrorKind };
}

export type Reply = Ok | Err;

export interface BrowserType {
  launch(opts: {
    headless: boolean;
  }): Promise<{ close(): Promise<void>; newContext(): Promise<unknown> }>;
}

export interface PageHandle {
  goto(url: string, opts?: unknown): Promise<unknown>;
  click(selector: string, opts?: unknown): Promise<void>;
  fill(selector: string, value: string, opts?: unknown): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  content(): Promise<string>;
  screenshot(opts?: unknown): Promise<Buffer>;
  evaluate(fn: string): Promise<unknown>;
  url(): string;
  close(): Promise<void>;
}

/** Minimal slice of Playwright's `Request` used by the navigation SSRF guard. */
export interface RouteRequest {
  url(): string;
  isNavigationRequest(): boolean;
}

/** Minimal slice of Playwright's `Route` used by the navigation SSRF guard. */
export interface RouteHandle {
  request(): RouteRequest;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

export interface PlaywrightHandle {
  // Loosely typed so we can avoid importing the playwright types at compile time —
  // they're an optional peer dependency.
  readonly browser: { close(): Promise<void> };
  readonly context: {
    newPage(): Promise<unknown>;
    close(): Promise<void>;
    /** Optional because the type is a loose projection; real Playwright contexts always have it. */
    route?(pattern: string, handler: (route: RouteHandle) => Promise<void> | void): Promise<void>;
  };
  readonly page: PageHandle;
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function badParams(msg: string): Error {
  const e = new Error(msg);
  (e as Error & { kind?: string }).kind = 'runtime';
  return e;
}
