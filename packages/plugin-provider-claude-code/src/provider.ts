import type { LLMProvider, ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { estimateTextTokens } from '@moxxy/sdk';
import { anthropicModels } from '@moxxy/plugin-provider-anthropic';
import { CLAUDE_CODE_PROVIDER_ID } from './constants.js';
import { runClaudeProcess, type ClaudeSpawn } from './process.js';
import { createProtocolState, parseClaudeRecord, serializeClaudePrompt } from './protocol.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const NON_TEXT_BLOCK_TOKENS = 256;

export interface ClaudeCodeProviderConfig {
  /** Installed Claude Code executable. Defaults to the command resolved from PATH. */
  readonly executable?: string;
  /** Optional default model override. */
  readonly defaultModel?: string;
  /** Process test seam; production callers should leave this unset. */
  readonly spawn?: ClaudeSpawn;
  /** Legacy host credential fields are intentionally ignored; the CLI owns authentication. */
  readonly oauthToken?: string;
  readonly oauthExpiresAt?: number;
  readonly oauthRefresh?: () => Promise<{ readonly token: string; readonly expiresAt?: number }>;
}

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = CLAUDE_CODE_PROVIDER_ID;
  readonly models = anthropicModels;

  private readonly executable: string;
  private readonly defaultModel: string;
  private readonly spawn?: ClaudeSpawn;

  constructor(config: ClaudeCodeProviderConfig = {}) {
    this.executable = config.executable ?? 'claude';
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    if (config.spawn) this.spawn = config.spawn;
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const model = req.model || this.defaultModel;
    yield { type: 'message_start', model };

    let prompt: string;
    try {
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
              message: next.value.stderr || `Claude CLI exited with code ${next.value.exitCode}`,
              retryable: false,
            };
            return;
          }
          break;
        }
        for (const event of parseClaudeRecord(next.value, state)) {
          if (event.type === 'message_end' || event.type === 'error') terminal = true;
          yield event;
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

function nonRetryableError(error: unknown): ProviderEvent {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
