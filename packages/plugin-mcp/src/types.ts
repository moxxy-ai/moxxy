export interface StdioServerConfig {
  readonly kind?: 'stdio';
  readonly name: string;
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

export interface SseServerConfig {
  readonly kind: 'sse';
  readonly name: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export interface StreamableHttpServerConfig {
  readonly kind: 'http';
  readonly name: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export type McpServerConfig = StdioServerConfig | SseServerConfig | StreamableHttpServerConfig;

export interface McpPluginOptions {
  readonly servers: ReadonlyArray<McpServerConfig>;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly toolNamePrefix?: (serverName: string, toolName: string) => string;
}

export interface McpClientLike {
  listTools(): Promise<{ tools: ReadonlyArray<McpToolDescriptor> }>;
  callTool(args: { name: string; arguments: unknown }): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}

export interface McpCallResult {
  readonly content?: ReadonlyArray<McpContentBlock>;
  readonly isError?: boolean;
}

export type McpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'resource'; readonly resource: unknown };

export function defaultToolNamePrefix(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}
