import type { Plugin } from '@moxxy/sdk';

export interface MobileGatewayOptions {
  readonly [key: string]: unknown;
}

export const mobileGatewayPlugin: Plugin;
export default mobileGatewayPlugin;
export function resolveMobileGatewayOptions(options?: MobileGatewayOptions): Record<string, unknown>;
export function resolveMobileExpoOptions(options?: MobileGatewayOptions): {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
};
export function buildExpoStartArgs(options: { readonly host: string; readonly port: number }): string[];
export function resolveMobileAppDir(cwd?: string): string | null;
export function isDirectRun(argvPath?: string, moduleUrl?: string): boolean;
export function startServer(): {
  readonly start: () => Promise<{
    readonly url: string;
    readonly wsUrl: string;
    readonly stop: () => Promise<void>;
  }>;
};
export class PairingStore {
  constructor(opts?: { readonly code?: string; readonly tokenFactory?: () => string });
  readonly code: string;
  pairingInfo(url: string): {
    readonly code: string;
    readonly url: string;
    readonly lanUrl: string;
    readonly qrPayload: string;
  };
  consumeCode(code: string): { readonly token: string } | null;
  isAuthorized(token: string | null | undefined): boolean;
}
export function createMobileGatewayServer(options?: MobileGatewayOptions): {
  readonly start: () => Promise<{
    readonly url: string;
    readonly wsUrl: string;
    readonly stop: () => Promise<void>;
  }>;
};
export function runMobileGatewayCommand(options?: MobileGatewayOptions, deps?: Record<string, unknown>): Promise<number>;
export function startMobileRuntime(options?: MobileGatewayOptions, deps?: Record<string, unknown>): Promise<{
  readonly url: string;
  readonly stop: () => Promise<void>;
}>;
