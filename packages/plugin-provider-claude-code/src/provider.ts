import type { LLMProvider, ModelDescriptor, ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { estimateTextTokens } from '@moxxy/sdk';
import { CLAUDE_CODE_PROVIDER_ID } from './constants.js';
import { ClaudeProcessError, runClaudeProcess, type ClaudeSpawn } from './process.js';
import { createProtocolState, parseClaudeRecord, serializeClaudePrompt } from './protocol.js';

export const CLAUDE_CODE_DEFAULT_MODEL = 'claude-sonnet-4-6';
const NON_TEXT_BLOCK_TOKENS = 256;

/**
 * Models offered by Claude Code subscriptions through the installed CLI.
 *
 * This is deliberately independent of the Anthropic API catalog: the CLI has
 * its own availability policy, and this adapter only preserves streamed text.
 * Unsupported capabilities are explicit so every host sees the same text-only
 * contract rather than relying on how it interprets absent optional flags.
 */
const textOnlyCapabilities = {
  supportsTools: false,
  supportsStreaming: true,
  supportsImages: false,
  supportsDocuments: false,
  supportsAudio: false,
  supportsReasoning: false,
} as const;

export const claudeCodeModels: ReadonlyArray<ModelDescriptor> = [
  { id: CLAUDE_CODE_DEFAULT_MODEL, contextWindow: 1_000_000, maxOutputTokens: 64_000, ...textOnlyCapabilities },
  { id: 'claude-fable-5', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...textOnlyCapabilities },
  { id: 'claude-opus-4-8', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...textOnlyCapabilities },
  { id: 'claude-opus-4-7', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...textOnlyCapabilities },
  { id: 'claude-opus-4-6', contextWindow: 1_000_000, maxOutputTokens: 128_000, ...textOnlyCapabilities },
  { id: 'claude-haiku-4-5-20251001', contextWindow: 200_000, maxOutputTokens: 64_000, ...textOnlyCapabilities },
];

export interface ClaudeCodeProviderConfig {
  /** Installed Claude Code executable. Defaults to the command resolved from PATH. */
  readonly executable?: string;
  /** Persisted provider-item model (`plugins.provider.items.claude-code.model`). */
  readonly model?: string;
  /** Transport mode. Native tools are opt-in; omitted defaults to text-only. */
  readonly mode?: 'text' | 'native-tools';
  /** Claude CLI permission mode. Omitted uses the CLI's safe default. */
  readonly permissionMode?: 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';
  /** Optional allow-list of Claude native tool names. */
  readonly allowedTools?: ReadonlyArray<string>;
  /** Runner workspace. Supplied by CLI activation rather than user configuration. */
  readonly cwd?: string;
  /** Optional default model override (kept for programmatic callers). */
  readonly defaultModel?: string;
  /** Process test seam; production callers should leave this unset. */
  readonly spawn?: ClaudeSpawn;
  /** Time allowed for the first stream record. Defaults to 30 seconds. */
  readonly startupTimeoutMs?: number;
  /** Maximum silence between stream records. Defaults to 120 seconds. */
  readonly idleTimeoutMs?: number;
  /** Maximum captured stderr characters. Defaults to 2048. */
  readonly maxStderrChars?: number;
  /** Maximum characters in one stdout stream-json record. Defaults to 64 KiB. */
  readonly maxRecordChars?: number;
}

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = CLAUDE_CODE_PROVIDER_ID;
  readonly models = claudeCodeModels;

  private readonly executable: string;
  private readonly defaultModel: string;
  private readonly nativeTools: boolean;
  private readonly permissionMode?: string;
  private readonly allowedTools: ReadonlyArray<string>;
  private readonly cwd: string;
  private readonly spawn?: ClaudeSpawn;
  private readonly startupTimeoutMs?: number;
  private readonly idleTimeoutMs?: number;
  private readonly maxStderrChars?: number;
  private readonly maxRecordChars?: number;

  constructor(config: ClaudeCodeProviderConfig = {}) {
    this.executable = config.executable ?? 'claude';
    this.defaultModel = config.defaultModel ?? CLAUDE_CODE_DEFAULT_MODEL;
    this.nativeTools = config.mode === 'native-tools';
    if (config.permissionMode) this.permissionMode = config.permissionMode;
    this.allowedTools = config.allowedTools ?? [];
    this.cwd = config.cwd ?? process.cwd();
    if (config.spawn) this.spawn = config.spawn;
    if (config.startupTimeoutMs) this.startupTimeoutMs = config.startupTimeoutMs;
    if (config.idleTimeoutMs) this.idleTimeoutMs = config.idleTimeoutMs;
    if (config.maxStderrChars) this.maxStderrChars = config.maxStderrChars;
    if (config.maxRecordChars) this.maxRecordChars = config.maxRecordChars;
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const model = req.model || this.defaultModel;
    yield { type: 'message_start', model };

    let prompt: string;
    try {
      assertSupportedModel(model);
      assertTextOnlyRequest(req);
      prompt = serializeClaudePrompt(req);
    } catch (error) {
      yield nonRetryableError(error);
      return;
    }

    const state = createProtocolState();
    let terminal = false;
    let lines: ReturnType<typeof runClaudeProcess> | undefined;
    try {
      lines = runClaudeProcess({
        executable: this.executable,
        model,
        prompt,
        cwd: this.cwd,
        nativeTools: this.nativeTools,
        allowedTools: this.allowedTools,
        ...(this.permissionMode ? { permissionMode: this.permissionMode } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
        ...(this.spawn ? { spawn: this.spawn } : {}),
        ...(this.startupTimeoutMs ? { startupTimeoutMs: this.startupTimeoutMs } : {}),
        ...(this.idleTimeoutMs ? { idleTimeoutMs: this.idleTimeoutMs } : {}),
        ...(this.maxStderrChars ? { maxStderrChars: this.maxStderrChars } : {}),
        ...(this.maxRecordChars ? { maxRecordChars: this.maxRecordChars } : {}),
      });
      while (true) {
        const next = await lines.next();
        if (next.done) {
          if (next.value.exitCode !== 0 && !terminal) {
            yield classifyClaudeFailure(
              model,
              next.value.stderr || `Claude CLI exited unexpectedly with code ${next.value.exitCode}`,
            );
            return;
          }
          break;
        }
        for (const event of parseClaudeRecord(next.value, state)) {
          if (event.type === 'message_end') {
            terminal = true;
            yield event;
            return;
          }
          if (event.type === 'error') {
            terminal = true;
            yield classifyClaudeFailure(model, event.message);
            return;
          }
          yield event;
        }
      }
      if (!terminal) {
        yield { type: 'error', message: 'Claude CLI ended without a terminal result record', retryable: false };
      }
    } catch (error) {
      if (error instanceof ClaudeProcessError) {
        yield {
          type: 'error',
          message: error.message,
          retryable: error.failure === 'startup_timeout' || error.failure === 'idle_timeout',
        };
      } else {
        yield classifySpawnFailure(error, this.executable);
      }
    } finally {
      await lines?.return({ exitCode: 0, stderr: '' });
    }
  }

  async countTokens(
    req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>,
  ): Promise<number> {
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
}

export function createClaudeCodeClient(config: ClaudeCodeProviderConfig = {}): LLMProvider {
  return new ClaudeCodeProvider(config);
}

function assertSupportedModel(model: string): void {
  if (claudeCodeModels.some((candidate) => candidate.id === model)) return;
  throw new Error(
    `Claude Code model "${model}" is not supported by this adapter. ` +
    `Select a supported model: ${claudeCodeModels.map((candidate) => candidate.id).join(', ')}.`,
  );
}

function assertTextOnlyRequest(req: ProviderRequest): void {
  if (req.tools && req.tools.length > 0) {
    throw new Error('Claude CLI text transport does not support tools');
  }
  if (req.reasoning) {
    throw new Error('Claude CLI text transport does not support reasoning');
  }
}

function classifyClaudeFailure(model: string, detail: string): ProviderEvent {
  if (/model|unknown model|invalid model/i.test(detail)) {
    return {
      type: 'error',
      message: `Claude Code rejected model "${model}": ${detail}. Select a supported model: ${claudeCodeModels.map((candidate) => candidate.id).join(', ')}.`,
      retryable: false,
    };
  }
  if (/not logged in|signed out|login required|authenticate|authentication|unauthorized|invalid.*(?:token|credential)|\b401\b/i.test(detail)) {
    return {
      type: 'error',
      message: `Claude CLI is signed out or its authentication was rejected: ${detail}. Run \`moxxy login claude-code\` to sign in again.`,
      retryable: false,
    };
  }
  if (/permission|denied|not allowed|forbidden|\b403\b/i.test(detail)) {
    return {
      type: 'error',
      message: `Claude Code permission denied: ${detail}. Review plugins.provider.items.claude-code.config.permissionMode and allowedTools.`,
      retryable: false,
    };
  }
  if (/rate.?limit|too many requests|\b429\b|overload|temporar|unavailable|service error|\b5\d\d\b/i.test(detail)) {
    return { type: 'error', message: `Claude Code service failure: ${detail}`, retryable: true };
  }
  return { type: 'error', message: `Claude CLI failed: ${detail}`, retryable: false };
}

function classifySpawnFailure(error: unknown, executable: string): ProviderEvent {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === 'ENOENT') {
    return {
      type: 'error',
      message: `Claude CLI executable not found: ${executable}. Install it with \`npm install -g @anthropic-ai/claude-code\` or configure plugins.provider.items.claude-code.config.executable.`,
      retryable: false,
    };
  }
  return nonRetryableError(error);
}

function nonRetryableError(error: unknown): ProviderEvent {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
