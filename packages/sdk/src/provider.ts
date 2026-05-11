import type { ToolDef } from './tool.js';

export interface ProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool_result';
  readonly content: ReadonlyArray<ContentBlock>;
}

export type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly isError?: boolean }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string };

export interface ProviderRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: ReadonlyArray<ProviderMessage>;
  readonly tools?: ReadonlyArray<ToolDef>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export type ProviderEvent =
  | { readonly type: 'message_start'; readonly model: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'tool_use_start'; readonly id: string; readonly name: string }
  | { readonly type: 'tool_use_delta'; readonly id: string; readonly partialInput: string }
  | { readonly type: 'tool_use_end'; readonly id: string; readonly input: unknown }
  | { readonly type: 'message_end'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error'; readonly usage?: TokenUsage }
  | { readonly type: 'error'; readonly message: string; readonly retryable: boolean };

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
  countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number>;
}

export interface ProviderDef {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  createClient(config: Record<string, unknown>): LLMProvider;
}
