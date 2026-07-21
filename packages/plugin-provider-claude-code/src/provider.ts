import type { LLMProvider, ModelDescriptor, ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { estimateTextTokens } from '@moxxy/sdk';
import { CLAUDE_CODE_PROVIDER_ID } from './constants.js';
import { runClaudeProcess, type ClaudeSpawn } from './process.js';
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
  /** Optional default model override (kept for programmatic callers). */
  readonly defaultModel?: string;
  /** Process test seam; production callers should leave this unset. */
  readonly spawn?: ClaudeSpawn;
}

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = CLAUDE_CODE_PROVIDER_ID;
  readonly models = claudeCodeModels;

  private readonly executable: string;
  private readonly defaultModel: string;
  private readonly spawn?: ClaudeSpawn;

  constructor(config: ClaudeCodeProviderConfig = {}) {
    this.executable = config.executable ?? 'claude';
    this.defaultModel = config.defaultModel ?? CLAUDE_CODE_DEFAULT_MODEL;
    if (config.spawn) this.spawn = config.spawn;
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
    try {
      const lines = runClaudeProcess({
        executable: this.executable,
        model,
        prompt,
        ...(req.signal ? { signal: req.signal } : {}),
        ...(this.spawn ? { spawn: this.spawn } : {}),
      });
      while (true) {
        const next = await lines.next();
        if (next.done) {
          if (next.value.exitCode !== 0 && !terminal) {
            yield {
              type: 'error',
              message: modelSelectionError(
                model,
                next.value.stderr || `Claude CLI exited with code ${next.value.exitCode}`,
              ),
              retryable: false,
            };
            return;
          }
          break;
        }
        for (const event of parseClaudeRecord(next.value, state)) {
          if (event.type === 'message_end') terminal = true;
          if (event.type === 'error') {
            terminal = true;
            yield { ...event, message: modelSelectionError(model, event.message) };
          } else {
            yield event;
          }
        }
      }
      if (!terminal) {
        yield { type: 'error', message: 'Claude CLI ended without a terminal result record', retryable: false };
      }
    } catch (error) {
      yield nonRetryableError(error);
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

function modelSelectionError(model: string, detail: string): string {
  return `Claude Code rejected model "${model}": ${detail}. ` +
    `Select a supported model: ${claudeCodeModels.map((candidate) => candidate.id).join(', ')}.`;
}

function nonRetryableError(error: unknown): ProviderEvent {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
