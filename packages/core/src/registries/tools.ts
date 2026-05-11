import type { EventLogReader, ToolContext, ToolDef } from '@moxxy/sdk';
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
}

export class ToolRegistryImpl implements ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();
  private readonly defaultLogger: Logger;
  private readonly defaultCwd: string;

  constructor(opts: { logger: Logger; cwd: string }) {
    this.defaultLogger = opts.logger;
    this.defaultCwd = opts.cwd;
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
    const parsed = tool.inputSchema.parse(input);

    const ctx: ToolContext = {
      sessionId: asSessionId(opts.sessionId ?? 'no-session'),
      turnId: asTurnId(opts.turnId ?? 'no-turn'),
      callId: asToolCallId(opts.callId ?? 'no-call'),
      cwd: opts.cwd ?? this.defaultCwd,
      signal,
      log: opts.log ?? emptyLog(),
      logger: opts.logger ?? this.defaultLogger,
    };

    const result = await tool.handler(parsed, ctx);
    if (tool.outputSchema) return tool.outputSchema.parse(result);
    return result;
  }
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
