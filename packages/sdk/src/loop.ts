import type { CompactorDef } from './compactor.js';
import type { EmittedEvent, MoxxyEvent } from './events.js';
import type { HookDispatcher } from './hooks.js';
import type { SessionId, TurnId } from './ids.js';
import type { EventLogReader } from './log.js';
import type { PermissionResolver } from './permission.js';
import type { LLMProvider } from './provider.js';
import type { Skill } from './skill.js';
import type { ToolDef } from './tool.js';

export interface ToolRegistry {
  list(): ReadonlyArray<ToolDef>;
  get(name: string): ToolDef | undefined;
  execute(name: string, input: unknown, signal: AbortSignal, opts?: ToolExecuteOpts): Promise<unknown>;
}

export interface ToolExecuteOpts {
  readonly callId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly log?: EventLogReader;
  readonly cwd?: string;
}

export interface SkillRegistry {
  list(): ReadonlyArray<Skill>;
  get(id: string): Skill | undefined;
  byName(name: string): Skill | undefined;
  filterByTriggers(prompt: string): ReadonlyArray<Skill>;
}

export interface PluginHostHandle {
  list(): ReadonlyArray<{ name: string; version: string; loaded: boolean }>;
  reload(): Promise<void>;
}

export interface LoopContext {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly provider: LLMProvider;
  readonly tools: ToolRegistry;
  readonly skills: SkillRegistry;
  readonly log: EventLogReader;
  readonly compactor: CompactorDef | null;
  readonly permissions: PermissionResolver;
  readonly hooks: HookDispatcher;
  readonly pluginHost: PluginHostHandle;
  readonly signal: AbortSignal;
  readonly maxIterations?: number;
  emit(event: EmittedEvent): Promise<MoxxyEvent>;
}

export interface LoopStrategyDef {
  readonly name: string;
  run(ctx: LoopContext): AsyncIterable<MoxxyEvent>;
}
