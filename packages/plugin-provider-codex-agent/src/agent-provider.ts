import {
  estimateTextTokens,
  type AgentStepEvent,
  type AgentStepRequest,
  type AgentTurnStart,
  type LLMProvider,
  type ModelDescriptor,
  type ProviderEvent,
  type ProviderRequest,
  type TokenUsage,
} from '@moxxy/sdk';
import { AgentSessionPool, Inbox, JsonRpcLineClient, oneOffPrompt, type AgentSessionLease } from '@moxxy/agent-connection-kit';
import { CODEX_AGENT_NAME, CODEX_AGENT_PROVIDER_ID } from './constants.js';
import { CodexAgentSession, type StartCodexAppServer } from './codex-session.js';
import { spawnCodexAppServer } from './executable.js';
import type { CodexThreadResponse, CodexTokenUsage, CodexTurn } from './protocol.js';
import { toTokenUsage } from './translate.js';

export const CODEX_AGENT_DEFAULT_MODEL = 'gpt-6-astra';
const NON_TEXT_BLOCK_TOKENS = 256;
const MAX_LIVE_CODEX_SESSIONS = 8;

const agentCapabilities = {
  supportsTools: true,
  supportsStreaming: true,
  supportsImages: true,
  supportsDocuments: false,
  supportsAudio: false,
  supportsReasoning: true,
  supportsFast: true,
  hostedTools: ['web_search'],
} as const;

/** Models Codex offers on a ChatGPT sign-in, used until Codex's own `model/list` answered; Codex decides what the account may use. */
export const codexAgentModels: ReadonlyArray<ModelDescriptor> = [
  { id: CODEX_AGENT_DEFAULT_MODEL, contextWindow: 272_000, maxOutputTokens: 128_000, ...agentCapabilities },
  // Codex 0.163's own catalog: 500k for 6.1 Sol, 272k for the rest (the API models have 1.05M).
  { id: 'gpt-6.1-sol', contextWindow: 500_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'gpt-6-sol', contextWindow: 272_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'gpt-6-luna', contextWindow: 272_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'gpt-5.6-sol', contextWindow: 272_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'gpt-5.6-terra', contextWindow: 272_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'gpt-5.6-luna', contextWindow: 272_000, maxOutputTokens: 128_000, ...agentCapabilities },
];

export interface CodexAgentProviderConfig {
  /** The person's Codex CLI; resolved from PATH when left out. */
  readonly executable?: string;
  /** Persisted provider-item model (`plugins.provider.items.codex-agent.model`). */
  readonly model?: string;
  readonly defaultModel?: string;
  /** Runner workspace, supplied on activation. */
  readonly cwd?: string;
  /** How `codex app-server` is started; spawns the person's Codex by default. */
  readonly startAppServer?: StartCodexAppServer;
  /** The live Codex sessions; shared across the process by default. */
  readonly sessions?: AgentSessionPool<CodexAgentSession>;
}

let sharedSessions: AgentSessionPool<CodexAgentSession> | undefined;

/** The live Codex sessions of this process, one per Moxxy conversation. */
export function codexSessions(): AgentSessionPool<CodexAgentSession> {
  sharedSessions ??= new AgentSessionPool<CodexAgentSession>({ limit: MAX_LIVE_CODEX_SESSIONS });
  return sharedSessions;
}

/**
 * The Codex agent connection: Codex does each turn itself through
 * `codex app-server`, unmodified (its instructions, config, tools, skills and
 * MCP servers), on the person's ChatGPT sign-in. Moxxy adds only its own MCP
 * server to the thread, and nothing to the prompt.
 */
export class CodexAgentProvider implements LLMProvider {
  readonly name = CODEX_AGENT_PROVIDER_ID;
  readonly agentName = CODEX_AGENT_NAME;
  /** Its own plan mode and goal: Moxxy shows the plan and ends the goal when the agent says so. */
  readonly agentOwns = { plan: true, goal: true } as const;
  readonly models = codexAgentModels;
  private readonly defaultModel: string;
  private readonly start: StartCodexAppServer;

  constructor(private readonly config: CodexAgentProviderConfig = {}) {
    this.defaultModel = config.model ?? config.defaultModel ?? CODEX_AGENT_DEFAULT_MODEL;
    this.start = config.startAppServer ?? spawnCodexAppServer(config.executable ?? 'codex');
  }

  async *agentStep(req: AgentStepRequest): AsyncIterable<AgentStepEvent> {
    let lease: AgentSessionLease<CodexAgentSession>;
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

  /**
   * Work Codex left running (a subagent, a command in the background) ended
   * between turns. Codex starts no turn then, so Moxxy opens one to show it.
   */
  onAgentTurn(listener: (start: AgentTurnStart) => void): () => void {
    return this.sessions().onAgentTurn(listener);
  }

  private sessions(): AgentSessionPool<CodexAgentSession> {
    return this.config.sessions ?? codexSessions();
  }

  /** One-off text (summaries, skill drafts): an ephemeral read-only Codex thread, kept nowhere. */
  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const model = req.model || this.defaultModel;
    yield { type: 'message_start', model };
    const cwd = this.config.cwd ?? process.cwd();
    let usage: TokenUsage | undefined;
    let connection: Awaited<ReturnType<StartCodexAppServer>> | undefined;
    try {
      connection = await this.start({ cwd });
      const client = new JsonRpcLineClient({ readable: connection.readable, writable: connection.writable });
      const notes = new Inbox<{ readonly method: string; readonly params: Record<string, unknown> } | null>();
      client.onNotification((method, params) => notes.push({ method, params: (params ?? {}) as Record<string, unknown> }));
      connection.readable.once('close', () => notes.push(null));
      await client.request('initialize', { clientInfo: { name: 'moxxy', title: 'Moxxy', version: '1' }, capabilities: { experimentalApi: true } });
      client.notify('initialized');
      const { system, prompt } = oneOffPrompt(req);
      const thread = await client.request<CodexThreadResponse>('thread/start', {
        cwd,
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        model,
        ...(system ? { developerInstructions: system } : {}),
      });
      const started = await client.request<{ turn: CodexTurn }>(
        'turn/start',
        { threadId: thread.thread.id, input: [{ type: 'text', text: prompt, text_elements: [] }] },
        req.signal,
      );
      const stop = () => void client.request('turn/interrupt', { threadId: thread.thread.id, turnId: started.turn.id }).catch(() => undefined);
      req.signal?.addEventListener('abort', stop, { once: true });
      try {
        for (;;) {
          const note = await notes.next();
          if (note === null) throw new Error('Codex stopped.');
          const { method, params } = note;
          if (params.turnId !== undefined && params.turnId !== started.turn.id) continue;
          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') yield { type: 'text_delta', delta: params.delta };
          else if (method === 'thread/tokenUsage/updated') {
            const last = (params.tokenUsage as { last?: CodexTokenUsage } | undefined)?.last;
            if (last) usage = toTokenUsage(last);
          } else if (method === 'turn/completed') {
            const turn = params.turn as CodexTurn | undefined;
            if (!turn || turn.id !== started.turn.id) continue;
            if (turn.status === 'failed') {
              yield { type: 'error', message: `Codex: ${turn.error?.message ?? 'the turn failed'}`, retryable: false };
              return;
            }
            break;
          }
        }
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

  /** The conversation's running Codex, or a new one (resuming its thread) when there is none that fits. */
  private async lease(req: AgentStepRequest): Promise<AgentSessionLease<CodexAgentSession>> {
    const settings = {
      start: this.start,
      cwd: req.cwd,
      ...(req.model ? { model: req.model } : {}),
      tools: req.allTools ?? req.tools,
      ...(req.skills ? { skills: req.skills } : {}),
      ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
      onAgentTurn: (name: string) => this.sessions().agentTurn({ sessionId: req.sessionId, name }),
    };
    const sessions = this.sessions();
    const create = () => CodexAgentSession.start(settings);
    const lease = await sessions.acquire(req.sessionId, { signal: req.signal, create });
    if (lease.session.isAlive && lease.session.fits(settings)) return lease;
    await lease.discard();
    return sessions.acquire(req.sessionId, { signal: req.signal, create });
  }
}

export function createCodexAgentClient(config: CodexAgentProviderConfig = {}): LLMProvider {
  return new CodexAgentProvider(config);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
