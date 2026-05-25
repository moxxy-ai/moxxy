import type { ModeContext, SubagentResult, SubagentSpec } from '@moxxy/sdk';

import {
  SUBAGENT_ALLOWED_TOOLS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_SYSTEM_PROMPT,
} from './constants.js';

export interface FanoutOutcome {
  readonly results: ReadonlyArray<SubagentResult>;
  readonly errored: ReadonlyArray<{ readonly index: number; readonly message: string }>;
}

/**
 * Findings accumulated across rounds — each entry is one subagent's
 * outcome plus the round it ran in. Synthesis and follow-up planning
 * both work off this flat list.
 */
export interface RoundFinding {
  readonly round: number;
  readonly question: string;
  readonly text: string;
  readonly error?: string;
}

export function flattenOutcome(
  round: number,
  queries: ReadonlyArray<string>,
  outcome: FanoutOutcome,
): RoundFinding[] {
  return queries.map((question, i) => {
    const r = outcome.results[i];
    const err = outcome.errored.find((e) => e.index === i);
    return {
      round,
      question,
      text: (r?.text ?? '').trim(),
      ...(err ? { error: err.message } : {}),
    };
  });
}

/**
 * Spawn one subagent per query in parallel, each constrained to web /
 * read-only tools. When `priorFindings` is non-empty, the prior
 * findings are embedded in each subagent's user prompt so follow-up
 * agents see what earlier rounds already gathered (which is the whole
 * point of multi-round research — round-2 follow-ups should not be
 * blind to round-1's findings).
 *
 * Caller MUST have verified ctx.subagents is present.
 */
export async function runFanout(
  ctx: ModeContext,
  queries: ReadonlyArray<string>,
  priorFindings: ReadonlyArray<RoundFinding> = [],
): Promise<FanoutOutcome> {
  if (!ctx.subagents) {
    throw new Error('deep-research: runFanout called without ctx.subagents — caller bug');
  }

  const specs: SubagentSpec[] = queries.map((q, i) => ({
    prompt: buildSubagentPrompt(q, priorFindings),
    systemPrompt: SUBAGENT_SYSTEM_PROMPT,
    mode: 'tool-use',
    maxIterations: SUBAGENT_MAX_ITERATIONS,
    allowedTools: [...SUBAGENT_ALLOWED_TOOLS],
    label: `subagent-${i + 1}`,
  }));

  const results = await ctx.subagents.spawnAll(specs);
  const errored: Array<{ index: number; message: string }> = [];
  results.forEach((r, i) => {
    if (r.error) errored.push({ index: i, message: r.error.message });
  });
  return { results, errored };
}

function buildSubagentPrompt(
  query: string,
  priorFindings: ReadonlyArray<RoundFinding>,
): string {
  if (priorFindings.length === 0) return query;
  const sections: string[] = [];
  sections.push(
    'Earlier research rounds gathered the following findings — use them as context for the focused question at the bottom, but you still need to do your own search to answer the focused question.',
  );
  sections.push('');
  for (const f of priorFindings) {
    sections.push(`### Round ${f.round}: ${f.question}`);
    if (f.error) {
      sections.push(`(errored: ${f.error})`);
    } else {
      sections.push(f.text || '(empty response)');
    }
    sections.push('');
  }
  sections.push('---');
  sections.push('');
  sections.push(`Your focused follow-up question:\n${query}`);
  return sections.join('\n');
}

/**
 * Build a one-screen digest of subagent outcomes for the synthesis gate.
 * Each entry shows the sub-question and a 200-char headline of the
 * findings, plus a clear marker for any subagent that errored.
 */
export function buildFanoutDigest(findings: ReadonlyArray<RoundFinding>): string {
  const total = findings.length;
  const errored = findings.filter((f) => f.error).length;
  const ok = total - errored;
  const head = `${ok} of ${total} subagent${total === 1 ? '' : 's'} returned`;
  const errStub = errored > 0 ? `, ${errored} errored` : '';

  const blocks = findings.map((f, i) => {
    if (f.error) {
      return `${i + 1}. [round ${f.round}] ${f.question}\n   [errored: ${f.error}]`;
    }
    const headline = f.text.trim().slice(0, 200).replace(/\n+/g, ' ');
    return `${i + 1}. [round ${f.round}] ${f.question}\n   ${headline || '(empty response)'}`;
  });

  return `${head}${errStub}.\n\n${blocks.join('\n\n')}`;
}

/**
 * Build the synthesis turn's user message: weaves the original question
 * back together with each subagent's writeup so the synthesizer has the
 * raw material to cite and combine.
 */
export function buildSynthesisInput(
  originalPrompt: string,
  findings: ReadonlyArray<RoundFinding>,
): string {
  const parts: string[] = [];
  parts.push(`Original question:\n${originalPrompt}`);
  parts.push('');
  parts.push('Sub-question findings:');
  findings.forEach((f, i) => {
    parts.push('');
    parts.push(`### #${i + 1} (round ${f.round}): ${f.question}`);
    if (f.error) {
      parts.push(`(errored: ${f.error})`);
    } else {
      parts.push(f.text || '(empty response)');
    }
  });
  return parts.join('\n');
}
