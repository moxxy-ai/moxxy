import type { MoxxyEvent, ToolCallRequestedEvent, ToolResultEvent } from './events.js';
import type { EventLogReader } from './log.js';
import type { PendingToolCall } from './permission.js';
import type { ProviderRequest } from './provider.js';
import type { SessionId, TurnId } from './ids.js';

export interface AppContext {
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly log: EventLogReader;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface TurnContext extends AppContext {
  readonly turnId: TurnId;
  readonly iteration: number;
}

export interface ToolCallContext extends TurnContext {
  readonly call: PendingToolCall;
}

export interface ToolResultContext extends TurnContext {
  readonly result: ToolResultEvent;
}

export type ToolCallVerdict =
  | { readonly action: 'allow' }
  | { readonly action: 'deny'; readonly reason: string }
  | { readonly action: 'rewrite'; readonly input: unknown };

export interface LifecycleHooks {
  onInit?(ctx: AppContext): void | Promise<void>;
  onTurnStart?(ctx: TurnContext): void | Promise<void>;
  onBeforeProviderCall?(req: ProviderRequest, ctx: TurnContext): ProviderRequest | void | Promise<ProviderRequest | void>;
  onToolCall?(ctx: ToolCallContext): ToolCallVerdict | void | Promise<ToolCallVerdict | void>;
  onToolResult?(ctx: ToolResultContext): ToolResultEvent | void | Promise<ToolResultEvent | void>;
  onEvent?(event: MoxxyEvent, ctx: AppContext): void | Promise<void>;
  onTurnEnd?(ctx: TurnContext): void | Promise<void>;
  onShutdown?(ctx: AppContext): void | Promise<void>;
}

export interface HookDispatcher {
  dispatchInit(ctx: AppContext): Promise<void>;
  dispatchTurnStart(ctx: TurnContext): Promise<void>;
  dispatchBeforeProviderCall(req: ProviderRequest, ctx: TurnContext): Promise<ProviderRequest>;
  dispatchToolCall(ctx: ToolCallContext): Promise<ToolCallVerdict>;
  dispatchToolResult(ctx: ToolResultContext): Promise<ToolResultEvent>;
  dispatchEvent(event: MoxxyEvent, ctx: AppContext): Promise<void>;
  dispatchTurnEnd(ctx: TurnContext): Promise<void>;
  dispatchShutdown(ctx: AppContext): Promise<void>;
}

export type ToolCallRequest = ToolCallRequestedEvent;
