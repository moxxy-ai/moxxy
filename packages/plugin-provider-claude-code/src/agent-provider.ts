import {
  estimateTextTokens,
  type AgentStepEvent,
  type AgentStepRequest,
  type AgentActivity,
  type AgentTurnStart,
  type LLMProvider,
  type ModelDescriptor,
  type ProviderEvent,
  type ProviderRequest,
  type TokenUsage,
} from '@moxxy/sdk';
import { AgentSessionPool, agentModeFor, oneOffPrompt, type AgentSessionLease } from '@moxxy/agent-connection-kit';
import { CLAUDE_AGENT_NAME, CLAUDE_CODE_PROVIDER_ID } from './constants.js';
import { ClaudeAgentSession, claudeEnv, startingPermissionMode, type ClaudeSessionSettings } from './agent-session.js';
import { ownPermissionMode } from './own-settings.js';
import { ensureClaudeAgentSdk } from './sdk-install.js';
import type { ClaudeAgentSdk, ClaudeEffort, ClaudePermissionMode } from './sdk-types.js';
import { toTokenUsage } from './translate.js';

export const CLAUDE_CODE_DEFAULT_MODEL = 'claude-sonnet-5-5';
const NON_TEXT_BLOCK_TOKENS = 256;
const MAX_LIVE_CLAUDE_SESSIONS = 8;

const agentCapabilities = {
  supportsTools: true,
  supportsStreaming: true,
  supportsImages: true,
  supportsDocuments: true,
  supportsAudio: false,
  supportsReasoning: true,
  hostedTools: ['web_search'],
} as const;

/** Models Claude Code offers on a Claude subscription, used until Claude's own `supportedModels()` answered; Claude Code decides what the account may use. */
export const claudeCodeModels: ReadonlyArray<ModelDescriptor> = [
  { id: 'claude-fable-5-1', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'claude-opus-5-5', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: CLAUDE_CODE_DEFAULT_MODEL, contextWindow: 1_000_000, maxOutputTokens: 128_000, ...agentCapabilities },
  { id: 'claude-haiku-5-5', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...agentCapabilities },
];

export interface ClaudeAgentProviderConfig {
  /** The person's Claude Code CLI; resolved from PATH when left out. */
  readonly executable?: string;
  /** Persisted provider-item model (`plugins.provider.items.claude-code.model`). */
  readonly model?: string;
  readonly defaultModel?: string;
  /** Runner workspace, supplied on activation. */
  readonly cwd?: string;
  /** Where the Agent SDK comes from; installs it into `~/.moxxy` by default. */
  readonly loadSdk?: () => Promise<ClaudeAgentSdk>;
  /** The live Claude sessions; shared across the process by default. */
  readonly sessions?: AgentSessionPool<ClaudeAgentSession>;
}

let sharedSessions: AgentSessionPool<ClaudeAgentSession> | undefined;

/** The live Claude sessions of this process, one per Moxxy conversation. */
export function claudeSessions(): AgentSessionPool<ClaudeAgentSession> {
  sharedSessions ??= new AgentSessionPool<ClaudeAgentSession>({ limit: MAX_LIVE_CLAUDE_SESSIONS });
  return sharedSessions;
}

/**
 * The Claude agent connection: Claude Code does each turn itself through the
 * Claude Agent SDK, unmodified (its preset, its settings, tools, skills and
 * MCP servers), on the person's Claude sign-in. Moxxy adds only its own MCP
 * server beside Claude's, and nothing to the prompt.
 */
export class ClaudeAgentProvider implements LLMProvider {
  readonly name = CLAUDE_CODE_PROVIDER_ID;
  readonly agentName = CLAUDE_AGENT_NAME;
  /** Its own plan mode and goal: Moxxy shows the plan and ends the goal when the agent says so. */
  readonly agentOwns = { plan: true, goal: true } as const;
  readonly models = claudeCodeModels;
  private readonly defaultModel: string;
  private readonly loadSdk: () => Promise<ClaudeAgentSdk>;

  constructor(private readonly config: ClaudeAgentProviderConfig = {}) {
    this.defaultModel = config.model ?? config.defaultModel ?? CLAUDE_CODE_DEFAULT_MODEL;
    this.loadSdk = config.loadSdk ?? (() => ensureClaudeAgentSdk());
  }

  async *agentStep(req: AgentStepRequest): AsyncIterable<AgentStepEvent> {
    let lease: AgentSessionLease<ClaudeAgentSession>;
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

  /** Claude takes up a turn by itself once a task it ran in the background finished. */
  onAgentTurn(listener: (start: AgentTurnStart) => void): () => void {
    return this.sessions().onAgentTurn(listener);
  }

  /** What Claude's background work does between turns, recorded at once. */
  onAgentActivity(listener: (activity: AgentActivity) => void): () => void {
    return this.sessions().onActivity(listener);
  }

  /** Stop one work Claude runs in the background in the conversation. */
  async stopBackgroundWork(sessionId: string, workId: string): Promise<boolean> {
    const live = this.sessions().running(sessionId);
    return live ? live.stopWork(workId) : false;
  }

  private sessions(): AgentSessionPool<ClaudeAgentSession> {
    return this.config.sessions ?? claudeSessions();
  }

  /** One-off text (summaries, skill drafts): Claude with no tools and no MCP servers, keeping no session. */
  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const model = req.model || this.defaultModel;
    yield { type: 'message_start', model };
    let usage: TokenUsage | undefined;
    try {
      const sdk = await this.loadSdk();
      const { system, prompt } = oneOffPrompt(req);
      const query = sdk.query({
        prompt,
        options: {
          cwd: this.config.cwd ?? process.cwd(),
          model,
          systemPrompt: system ?? '',
          ...(this.config.executable ? { pathToClaudeCodeExecutable: this.config.executable } : {}),
          tools: [],
          strictMcpConfig: true,
          persistSession: false,
          maxTurns: 1,
          env: claudeEnv(),
        },
      });
      req.signal?.addEventListener('abort', () => query.close(), { once: true });
      for await (const message of query) {
        if (message.type === 'assistant' && 'message' in message) {
          for (const block of message.message.content) {
            if (block.type === 'text' && 'text' in block && typeof block.text === 'string') yield { type: 'text_delta', delta: block.text };
          }
        } else if (message.type === 'result' && 'is_error' in message) {
          if (message.usage) usage = toTokenUsage(message.usage);
          if (message.is_error) {
            yield { type: 'error', message: `Claude Code: ${message.errors?.join('; ') ?? message.result ?? message.subtype}`, retryable: false };
            return;
          }
        }
      }
    } catch (err) {
      if (!req.signal?.aborted) yield { type: 'error', message: messageOf(err), retryable: false };
      return;
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

  /** The conversation's running Claude, or a new one (resuming Claude's own session) when there is none that fits. */
  private async lease(req: AgentStepRequest): Promise<AgentSessionLease<ClaudeAgentSession>> {
    const sdk = await this.loadSdk();
    // The person's own Claude is asked only when their recorded switch is off: then a default that acts without asking must not win.
    const ownMode = req.autoApproveRecorded && !req.autoApprove ? await ownPermissionMode(sdk, req.cwd) : undefined;
    const settings = this.settingsFor(req, sdk, ownMode);
    const sessions = this.sessions();
    const create = () => ClaudeAgentSession.start(settings);
    const lease = await sessions.acquire(req.sessionId, { signal: req.signal, create });
    if (lease.session.isAlive && lease.session.fits(settings)) return lease;
    await lease.discard();
    return sessions.acquire(req.sessionId, { signal: req.signal, create });
  }

  private settingsFor(req: AgentStepRequest, sdk: ClaudeAgentSdk, ownMode: ClaudePermissionMode | undefined): ClaudeSessionSettings {
    const effort = effortOf(req.reasoning);
    const permissionMode = startingPermissionMode(agentModeFor(req.mode), req.autoApprove, ownMode);
    return {
      sdk,
      cwd: req.cwd,
      model: req.model || this.defaultModel,
      ...(effort ? { effort } : {}),
      ...(this.config.executable ? { executable: this.config.executable } : {}),
      ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      tools: req.allTools ?? req.tools,
      ...(req.skills ? { skills: req.skills } : {}),
      onAgentTurn: (name, workId) => this.sessions().agentTurn({ sessionId: req.sessionId, name, ...(workId ? { workId } : {}) }),
      onActivity: (events) => this.sessions().activity({ sessionId: req.sessionId, events }),
    };
  }
}

export function createClaudeCodeClient(config: ClaudeAgentProviderConfig = {}): LLMProvider {
  return new ClaudeAgentProvider(config);
}

function effortOf(reasoning: AgentStepRequest['reasoning']): ClaudeEffort | undefined {
  return typeof reasoning === 'object' && reasoning.effort ? reasoning.effort : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
