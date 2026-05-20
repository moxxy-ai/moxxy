import type { z } from 'zod';
import type { EventLogReader } from './log.js';
import type { PermissionRule } from './permission.js';
import type { SessionId, ToolCallId, TurnId } from './ids.js';
import type { SubagentSpawner } from './subagent.js';
import type { ToolIsolationSpec } from './isolation.js';

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
  /**
   * Spawner for child agents — present when the tool was invoked inside
   * a run-turn loop (the normal case). Tools that fan work out (e.g.
   * `dispatch_agent`) call `subagents.spawn(...)` to start a focused
   * child loop and stream its events back to the parent log.
   */
  readonly subagents?: SubagentSpawner;
}

/**
 * Optional presentation hint for compact rendering in TUI/chat surfaces.
 * When present, the channel may aggregate consecutive calls of this tool
 * into one "live block" with a verb+count summary, rather than rendering
 * each call separately. Opting in is per-tool: noisy small-output tools
 * (Read, Grep, Glob, Edit) benefit; tools with rich output (Bash,
 * dispatch_agent) generally don't.
 *
 * Channels MAY ignore this hint — it's purely presentational. The event
 * log and provider serialization don't see it.
 */
export interface ToolCompactPresentation {
  /** Present-participle verb used in summary, e.g. "Reading", "Searching for". */
  readonly verb: string;
  /** Noun for the count, pluralized e.g. `{ one: 'file', other: 'files' }`. */
  readonly noun: { readonly one: string; readonly other: string };
  /** Input field whose value previews the latest call (the line under the summary).
   *  e.g. `"file_path"` for Read so the preview shows the file just read. */
  readonly previewKey?: string;
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
  /** Opt-in presentation hint. See `ToolCompactPresentation`. */
  readonly compact?: ToolCompactPresentation;
  /**
   * Optional capability declaration. Advisory unless the user enables
   * `@moxxy/plugin-security`, at which point the active `Isolator`
   * enforces these bounds at every call. See `ToolIsolationSpec`.
   */
  readonly isolation?: ToolIsolationSpec;
}
