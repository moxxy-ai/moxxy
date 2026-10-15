import {
  estimateTextTokens,
  type AgentStepEvent,
  type AgentStepRequest,
  type LLMProvider,
  type ModelDescriptor,
  type ProviderEvent,
  type ProviderRequest,
  type TokenUsage,
} from '@moxxy/sdk';
import { AgentSessionPool, Inbox, JsonRpcLineClient, oneOffPrompt, type AgentSessionLease } from '@moxxy/agent-connection-kit';
import { AcpAgentSession, CLIENT_CAPABILITIES, type AcpConnection, type StartAcpAgent } from './acp-session.js';
import { OPENCODE_AGENT, type AcpAgentSpec } from './agents.js';
import { spawnOpenCodeAcp } from './executable.js';
import { readOpenCodeMcpServers, readOpenCodeRules } from './login.js';
import type { ReadAgentMcpServers, ReadAgentRules } from './rules.js';
import { ACP_PROTOCOL_VERSION, type AcpPromptResponse, type AcpSessionResponse } from './protocol.js';
import { toTokenUsage } from './translate.js';

const NON_TEXT_BLOCK_TOKENS = 256;
const MAX_LIVE_SESSIONS = 8;
/** The agent picks its own window per model; this only sizes Moxxy's view of the conversation. */
const CONTEXT_WINDOW = 200_000;

const agentCapabilities = {
  contextWindow: CONTEXT_WINDOW,
  supportsTools: true,
  supportsStreaming: true,
  supportsImages: true,
  supportsDocuments: false,
  supportsAudio: false,
  supportsReasoning: true,
} as const;

export function acpModel(id: string): ModelDescriptor {
  return { id, ...agentCapabilities };
}

export interface AcpAgentProviderConfig {
  readonly agent?: AcpAgentSpec;
  /** The person's agent CLI; resolved from PATH when left out. */
  readonly executable?: string;
  /** Persisted provider-item model (`plugins.provider.items.opencode.model`). */
  readonly model?: string;
  readonly defaultModel?: string;
  /** Runner workspace, supplied on activation. */
  readonly cwd?: string;
  /** The models the person's agent offers (`opencode models`), read when the connection is switched on. */
  readonly models?: ReadonlyArray<string>;
  /** How the agent is started; spawns the person's `opencode acp` by default. */
  readonly startAgent?: StartAcpAgent;
  /** How the person's agent runs; reads `opencode debug agent` by default. */
  readonly readRules?: ReadAgentRules;
  /** The person's own MCP servers; reads `opencode debug config` by default. */
  readonly readMcpServers?: ReadAgentMcpServers;
  /** The live agent sessions; shared across the process by default. */
  readonly sessions?: AgentSessionPool<AcpAgentSession>;
}

let sharedSessions: AgentSessionPool<AcpAgentSession> | undefined;

/** The live ACP agent sessions of this process, one per Moxxy conversation. */
export function acpSessions(): AgentSessionPool<AcpAgentSession> {
  sharedSessions ??= new AgentSessionPool<AcpAgentSession>({ limit: MAX_LIVE_SESSIONS });
  return sharedSessions;
}

/**
 * An agent connection over the Agent Client Protocol: the agent (OpenCode)
 * does each turn itself, unmodified (its instructions, config, tools, skills,
 * permission rules and MCP servers). Moxxy adds only its own MCP server to
 * the session, and nothing to the prompt.
 */
export class AcpAgentProvider implements LLMProvider {
  readonly name: string;
  readonly agentName: string;
  readonly models: ModelDescriptor[];
  /** No plan hand-off and no goal of its own: Moxxy's plan and goal modes steer it. */
  readonly agentOwns = { plan: false, goal: false } as const;
  private readonly agent: AcpAgentSpec;
  private readonly defaultModel: string;
  private readonly start: StartAcpAgent;
  private readonly readRules: ReadAgentRules;
  private readonly readMcpServers: ReadAgentMcpServers;

  constructor(private readonly config: AcpAgentProviderConfig = {}) {
    this.agent = config.agent ?? OPENCODE_AGENT;
    this.name = this.agent.providerId;
    this.agentName = this.agent.label;
    this.defaultModel = config.model ?? config.defaultModel ?? this.agent.defaultModel;
    const ids = config.models && config.models.length > 0 ? config.models : [this.defaultModel];
    this.models = [...new Set([this.defaultModel, ...ids])].map(acpModel);
    this.start = config.startAgent ?? spawnOpenCodeAcp(config.executable ?? 'opencode');
    this.readRules = config.readRules ?? readOpenCodeRules(config.executable ?? 'opencode');
    this.readMcpServers = config.readMcpServers ?? readOpenCodeMcpServers(config.executable ?? 'opencode');
  }

  /** Any model the agent names can be picked; it gets the same description as the rest. */
  async prepareModel(model: string): Promise<void> {
    if (model && !this.models.some((descriptor) => descriptor.id === model)) this.models.push(acpModel(model));
  }

  async *agentStep(req: AgentStepRequest): AsyncIterable<AgentStepEvent> {
    let lease: AgentSessionLease<AcpAgentSession>;
    try {
      lease = await this.lease(req);
    } catch (err) {
      if (!req.signal.aborted) yield { type: 'error', message: messageOf(err), retryable: false };
      return;
    }
    try {
      yield* lease.session.turn(req);
    } finally {
      if (lease.session.isAlive) lease.release();
      else await lease.discard();
    }
  }

  /** One-off text (summaries, skill drafts): a session of its own in plan mode, without Moxxy's tools. */
  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const model = req.model || this.defaultModel;
    yield { type: 'message_start', model };
    const cwd = this.config.cwd ?? process.cwd();
    let usage: TokenUsage | undefined;
    let connection: AcpConnection | undefined;
    try {
      connection = await this.start({ cwd });
      const client = new JsonRpcLineClient({ readable: connection.readable, writable: connection.writable, jsonrpc: true });
      const deltas = new Inbox<string | null>();
      client.onNotification((method, params) => {
        const update = (params as { update?: { sessionUpdate?: unknown; content?: { type?: unknown; text?: unknown } } } | undefined)?.update;
        if (method === 'session/update' && update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') {
          deltas.push(update.content.text);
        }
      });
      await client.request('initialize', { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES });
      const session = await client.request<AcpSessionResponse>('session/new', { cwd, mcpServers: [] });
      const sessionId = session.sessionId;
      if (!sessionId) throw new Error(`${this.agent.label} started no session.`);
      for (const option of session.configOptions ?? []) {
        const wanted = option.category === 'model' ? model : option.category === 'mode' ? 'plan' : undefined;
        if (wanted && option.currentValue !== wanted && (option.options ?? []).some((o) => o.value === wanted)) {
          await client.request('session/set_config_option', { sessionId, configId: option.id, value: wanted });
        }
      }
      const { system, prompt } = oneOffPrompt(req);
      const text = [system, prompt].filter(Boolean).join('\n\n');
      const stop = () => client.notify('session/cancel', { sessionId });
      req.signal?.addEventListener('abort', stop, { once: true });
      const answered = client.request<AcpPromptResponse>('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }).finally(() => deltas.push(null));
      try {
        for (let delta = await deltas.next(); delta !== null; delta = await deltas.next()) yield { type: 'text_delta', delta };
        const result = await answered;
        if (result.usage) usage = toTokenUsage(result.usage);
      } finally {
        req.signal?.removeEventListener('abort', stop);
      }
    } catch (err) {
      if (!req.signal?.aborted) yield { type: 'error', message: messageOf(err), retryable: false };
      return;
    } finally {
      connection?.close();
    }
    yield { type: 'message_end', stopReason: 'end_turn', ...(usage ? { usage } : {}) };
  }

  async countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number> {
    let text = req.system ?? '';
    let nonTextBlocks = 0;
    for (const message of req.messages) {
      for (const block of message.content) {
        if (block.type === 'text') text += block.text;
        else nonTextBlocks += 1;
      }
    }
    for (const tool of req.tools ?? []) text += tool.name + tool.description;
    return estimateTextTokens(text) + nonTextBlocks * NON_TEXT_BLOCK_TOKENS;
  }

  /** The conversation's running agent, or a new one (loading its session) when there is none that fits. */
  private async lease(req: AgentStepRequest): Promise<AgentSessionLease<AcpAgentSession>> {
    const settings = {
      agent: this.agent,
      start: this.start,
      readRules: this.readRules,
      readMcpServers: this.readMcpServers,
      cwd: req.cwd,
      tools: req.allTools ?? req.tools,
      ...(req.skills ? { skills: req.skills } : {}),
      ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
    };
    const sessions = this.config.sessions ?? acpSessions();
    const create = () => AcpAgentSession.start(settings);
    const lease = await sessions.acquire(req.sessionId, { signal: req.signal, create });
    if (lease.session.isAlive && lease.session.fits(settings)) return lease;
    await lease.discard();
    return sessions.acquire(req.sessionId, { signal: req.signal, create });
  }
}

export function createAcpAgentClient(config: AcpAgentProviderConfig = {}): LLMProvider {
  return new AcpAgentProvider(config);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
