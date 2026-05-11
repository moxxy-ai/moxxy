import type { z } from 'zod';
import type { EventLogReader } from './log.js';
import type { PermissionRule } from './permission.js';
import type { SessionId, ToolCallId, TurnId } from './ids.js';

export interface ToolContext {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly callId: ToolCallId;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly log: EventLogReader;
  readonly logger: {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  /**
   * Optional native JSON Schema. When present, providers serializing tools to
   * their API should use this instead of converting `inputSchema` via zod.
   * Useful for tools originating from external systems (e.g., MCP) that already
   * carry a JSON Schema and where zod conversion would be lossy.
   */
  readonly inputJsonSchema?: unknown;
  readonly outputSchema?: z.ZodTypeAny;
  readonly permission?: PermissionRule;
  readonly handler: (input: unknown, ctx: ToolContext) => Promise<unknown> | unknown;
}
