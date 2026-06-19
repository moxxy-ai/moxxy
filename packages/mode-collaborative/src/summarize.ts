/**
 * Coordinator-side conversation summarizer for the collaboration BRIEF.
 *
 * One off-log provider call distils the user's dialogue into a short shared
 * brief, so the N spawned agents inherit the INTENT without each re-ingesting
 * the whole transcript (the full text lives in CONVERSATION.md for on-demand
 * recall). Mirrors `@moxxy/plugin-compactor-summarize`'s `providerSummary`:
 * a direct `provider.stream(...)` (NOT runSingleShotTurn, which would emit
 * provider/assistant events into the coordinator's own session log + run
 * compaction). Returns null on ANY failure so the caller falls back to a
 * deterministic heuristic — a brief must never sink the run.
 */

import type { LLMProvider } from '@moxxy/sdk';
import { digestTurns } from './brief.js';

/** Cap on the conversation text fed to the summarizer (head+tail if longer). */
const MAX_SUMMARIZE_INPUT_CHARS = 48_000;
const SUMMARY_MAX_TOKENS = 700;

export const COLLAB_SUMMARY_SYSTEM = `You write a SHORT shared brief for a team of AI agents about to build ONE deliverable together. From the user's conversation, extract ONLY:
1. The overall goal, in one or two sentences.
2. The concrete requirements and constraints.
3. Any decisions already made, and the reason.
4. Explicit do-nots / out-of-scope.
Use terse bullet points. Do NOT restate the raw conversation, do NOT invent details, omit chit-chat and pleasantries. Output ONLY the brief text — no preamble, no sign-off. Keep it well under 400 words.`;

/**
 * Summarize the conversation into a brief, or null if no provider/model is
 * available or the call fails. Never throws.
 */
export async function summarizeConversation(args: {
  task: string;
  events: ReadonlyArray<unknown>;
  provider?: LLMProvider;
  model?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { task, events, provider, model, signal } = args;
  // Explicit guard (must-fix): the coordinator ctx may carry neither provider
  // nor model (synthetic/test contexts). Fall back intentionally, not by relying
  // on an await rejection being swallowed downstream.
  if (!provider || !model) return null;

  const turns = digestTurns(events);
  if (turns.length === 0) return null;
  const joined = turns.map((t) => `[${t.role}] ${t.text}`).join('\n');
  const input =
    joined.length > MAX_SUMMARIZE_INPUT_CHARS
      ? `${joined.slice(0, MAX_SUMMARIZE_INPUT_CHARS / 2)}\n[... transcript truncated ...]\n${joined.slice(-MAX_SUMMARIZE_INPUT_CHARS / 2)}`
      : joined;

  try {
    let out = '';
    for await (const event of provider.stream({
      model,
      system: COLLAB_SUMMARY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Task headline: ${task}\n\nThe user's conversation that produced this task:\n\n${input}`,
            },
          ],
        },
      ],
      maxTokens: SUMMARY_MAX_TOKENS,
      ...(signal ? { signal } : {}),
    })) {
      if (event.type === 'text_delta') out += event.delta;
      if (event.type === 'error') return null;
    }
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
