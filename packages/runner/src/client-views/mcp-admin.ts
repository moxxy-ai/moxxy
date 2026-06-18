import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export interface McpServerStatus {
  readonly name: string;
  readonly enabled: boolean;
  readonly connected: boolean;
}
export interface McpAdminClientView {
  listServers(): Promise<ReadonlyArray<McpServerStatus>>;
  enableAndAttach(name: string): Promise<{ toolNames: ReadonlyArray<string> } | null>;
  detach(name: string): Promise<boolean>;
}

export function makeMcpAdminView(ctx: ViewContext): McpAdminClientView {
  const { peer } = ctx;
  return {
    listServers: () =>
      peer.request<ReadonlyArray<McpServerStatus>>(RunnerMethod.McpListServers),
    enableAndAttach: (name) =>
      peer.request<{ toolNames: ReadonlyArray<string> } | null>(
        RunnerMethod.McpEnableAndAttach,
        { name },
      ),
    detach: (name) => peer.request<boolean>(RunnerMethod.McpDetach, { name }),
  };
}
