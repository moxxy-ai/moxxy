import type { EventLogReader, SubagentSpawner, ToolContext, ToolDef } from '@moxxy/sdk';
import type { Logger } from '../logger.js';
import { asToolCallId, asSessionId, asTurnId } from '@moxxy/sdk';

export interface ToolRegistry {
  list(): ReadonlyArray<ToolDef>;
  get(name: string): ToolDef | undefined;
  has(name: string): boolean;
  register(tool: ToolDef): void;
  unregister(name: string): void;
  execute(name: string, input: unknown, signal: AbortSignal, opts?: ExecuteOptions): Promise<unknown>;
}

interface ExecuteOptions {
  readonly callId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly log?: EventLogReader;
  readonly logger?: Logger;
  readonly cwd?: string;
  /**
   * Optional spawner — passed by run-turn so multi-agent tools (e.g.
   * `dispatch_agent`) can fan work out from inside the tool-use loop.
   * Plain `tools.execute()` callers (tests, one-off scripts) may omit it.
   */
  readonly subagents?: SubagentSpawner;
}

export class ToolRegistryImpl implements ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();
  private readonly defaultLogger: Logger;
  private readonly defaultCwd: string;
  /**
   * Vault-backed secret resolver, when the host wires one. Surfaced to
   * every tool handler as `ctx.getSecret(name)` so plugins can read an
   * API key at call time without the value ever entering the model's
   * context or `process.env`.
   */
  private readonly secretResolver?: (name: string) => Promise<string | null>;

  constructor(opts: {
    logger: Logger;
    cwd: string;
    secretResolver?: (name: string) => Promise<string | null>;
  }) {
    this.defaultLogger = opts.logger;
    this.defaultCwd = opts.cwd;
    this.secretResolver = opts.secretResolver;
  }

  list(): ReadonlyArray<ToolDef> {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  register(tool: ToolDef): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  async execute(
    name: string,
    input: unknown,
    signal: AbortSignal,
    opts: ExecuteOptions = {},
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    // Use safeParse so a validation failure surfaces as a clean,
    // single-line error in the tool_result instead of the raw ZodError
    // (which JSON-stringifies into 20+ lines of red noise — observed
    // with memory_save and synthesize_skill). The formatted message tells
    // the model exactly which fields are off and why, so it can retry.
    const parseResult = tool.inputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new Error(`Invalid input for ${name}: ${formatZodIssues(parseResult.error)}`);
    }
    const parsed = parseResult.data;

    const ctx: ToolContext = {
      sessionId: asSessionId(opts.sessionId ?? 'no-session'),
      turnId: asTurnId(opts.turnId ?? 'no-turn'),
      callId: asToolCallId(opts.callId ?? 'no-call'),
      cwd: opts.cwd ?? this.defaultCwd,
      signal,
      log: opts.log ?? emptyLog(),
      logger: opts.logger ?? this.defaultLogger,
      ...(opts.subagents ? { subagents: opts.subagents } : {}),
      ...(this.secretResolver ? { getSecret: this.secretResolver } : {}),
    };

    const result = await tool.handler(parsed, ctx);
    if (tool.outputSchema) {
      // Mirror the input path: format an output-schema mismatch (a plugin bug)
      // into the same single-line message instead of letting the raw 20-line
      // ZodError surface, and name the offending tool + fields.
      const outResult = tool.outputSchema.safeParse(result);
      if (!outResult.success) {
        throw new Error(
          `Tool ${name} produced invalid output: ${formatZodIssues(outResult.error)}`,
        );
      }
      return outResult.data;
    }
    return result;
  }
}

/**
 * Format a ZodError's issues into a single-line, model-friendly string
 * (`path: message; path: message`). Used by both input and output validation
 * so the raw multi-line ZodError JSON noise never reaches the model.
 */
function formatZodIssues(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }): string {
  return error.issues
    .map((iss) => {
      const path = iss.path.length ? iss.path.join('.') : '(root)';
      return `${path}: ${iss.message}`;
    })
    .join('; ');
}

function emptyLog(): EventLogReader {
  return {
    length: 0,
    at: () => undefined,
    slice: () => [],
    ofType: () => [],
    byTurn: () => [],
    toJSON: () => [],
  };
}
