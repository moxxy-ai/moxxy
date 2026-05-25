import { asPluginId } from '@moxxy/sdk';

export const DEEP_RESEARCH_MODE_NAME = 'deep-research';

export const DEEP_RESEARCH_PLUGIN_ID = asPluginId('@moxxy/mode-deep-research');

/**
 * Asked once in the planning phase. The subagents fan out IN PARALLEL —
 * which means a query can never depend on another query's output. If we
 * let the planner emit "compare side A and side B" or "what are the
 * disputed claims" as separate queries, the subagent running them has
 * no idea what was actually gathered and either invents content or
 * gives up (e.g. "I can't determine what 'the disputed claims' refers
 * to from the prompt alone"). The synthesis phase already sees every
 * subagent's findings end-to-end and is where comparison + contradiction
 * analysis belongs — the planner's job is purely to spread the raw
 * gathering work across independent angles.
 */
export const QUERY_PLAN_SYSTEM_PROMPT = `You are scoping a deep-research task. Produce 2-5 PARALLEL GATHERING queries — one per independent angle of raw evidence the synthesis phase will need.

HARD RULES (the loop refuses plans that break these):
- Each query MUST be independently answerable from web search + page reads ALONE — without seeing any other query's output. The subagents run in parallel and never see each other's findings.
- DO NOT emit comparison, contradiction, "differences", "disputed claims", "which side is right", "balanced timeline", "verify side X's claims", or other queries that require knowing what OTHER queries returned. Those are the synthesis phase's job, not gathering.
- DO NOT pad. If the user's question only needs 2 angles (e.g. "compare X side vs Y side"), emit exactly 2 queries — one per side. The synthesis turn does the comparison.
- Each query should be concrete and scoped ("What did <party> say about <topic> in the last 30 days?"), not an open theme ("Background on X").
- No two queries should be rephrasings of each other.

Reply with EXACTLY this format and nothing else:

QUERIES:
1. <gathering query>
2. <gathering query>
...

Stop after the last numbered line.`;

/**
 * System prompt for each fan-out subagent. They run in standard tool-use
 * mode, but constrained (by allowedTools) to read-only web tools. The
 * SOURCES: block is what the synthesis phase pulls citations from.
 */
export const SUBAGENT_SYSTEM_PROMPT = `You are a focused research subagent. You have ONE sub-question to answer. Use web_search and web_fetch (and Read for any local files referenced) to gather evidence, then produce a concise writeup.

Stop tool-calling when you have enough material to answer. Reply with:

FINDINGS:
<2-4 short paragraphs answering the sub-question, citing sources inline like [1], [2] where claims come from a specific source>

SOURCES:
[1] <title> — <url>
[2] <title> — <url>
...

Do NOT edit files. Do NOT run git. Stop after the last source line.`;

/**
 * Asked between fan-out rounds. Given the findings from the prior
 * round(s), the model decides whether MORE parallel gathering is
 * needed to fill specific gaps before synthesis — and if so, what.
 * This is the "agentic" half of the loop that the user explicitly
 * asked for: round-1 gathers Iran-side + USA-side, round-2 spawns
 * follow-ups armed with both, instead of asking blind round-1
 * subagents to compare things they can't see.
 */
export const FOLLOWUP_PLAN_SYSTEM_PROMPT = `You have the findings of the previous research round(s). Decide whether you need MORE parallel gathering to fill specific gaps the synthesis phase can't resolve on its own.

You will receive:
- The original user question.
- Each prior subagent's question + FINDINGS + SOURCES block.

Decision rules:
- ONLY emit follow-ups when there is a CONCRETE gap that needs more raw evidence — a contradiction begging for a third source, a claim that needs primary-document verification, a missing data point that one round can't synthesize around.
- The follow-up subagents WILL be given the prior findings as context in their prompt, so phrasing like "verify the casualty figure of X reported by Iranian state media against independent sources" is fine.
- DO NOT emit follow-ups that just rephrase prior queries or chase tangents.
- Each follow-up still runs in parallel with the others in this round, so follow-ups must be independent of EACH OTHER (just like round-1 queries).
- If the prior findings are sufficient for a good synthesis, emit none and stop. The synthesis turn handles cross-cutting comparison without help.

Reply with EXACTLY one of these formats and nothing else:

FOLLOWUPS:
1. <follow-up gathering query>
2. <follow-up gathering query>
...

or

FOLLOWUPS: (none)

Stop after the last line.`;

/**
 * Synthesis turn: consume the per-subagent findings + sources and
 * produce a single structured writeup with renumbered citations.
 */
export const SYNTHESIS_SYSTEM_PROMPT = `You are synthesizing a deep-research report from the findings of multiple subagents — possibly across multiple research rounds (an initial gathering round plus optional follow-up rounds that drilled into specific gaps the initial round surfaced).

You will receive the original question, each subagent's question + round number + FINDINGS + SOURCES block. Produce the final writeup with these sections, in this order:

## Executive summary
<3-5 bullet points; the key takeaways.>

## Key findings
<numbered paragraphs covering each substantive finding, citing sources inline as [n] referring to the unified Sources list below. Call out contradictions explicitly. Mark gaps as "Not covered: …". When findings from a follow-up round resolve or amplify a contradiction the initial round surfaced, say so.>

## Sources
[1] <title> — <url>
[2] <title> — <url>
...
(Renumber so the unified list is contiguous; each source appears once even if cited by multiple subagents.)

## Open questions
<bullets describing what remains unresolved, or "None — the gathered evidence is sufficient.">

Be tight. Do not narrate your process.`;

/** Refuse plans larger than this in the initial round — guards against runaway fan-out cost. */
export const MAX_SUBAGENTS = 6;

/** Minimum subagents for fan-out to make sense; below this we still run, just smaller. */
export const MIN_SUBAGENTS = 1;

/** Maximum follow-up rounds after the initial gathering. */
export const MAX_FOLLOWUP_ROUNDS = 2;

/** Maximum follow-up queries per round. */
export const MAX_FOLLOWUPS_PER_ROUND = 4;

export const MAX_REDRAFTS = 3;

export const SUBAGENT_MAX_ITERATIONS = 40;
export const PLANNING_MAX_ITERATIONS = 3;
export const SYNTHESIS_MAX_ITERATIONS = 8;

/**
 * Tools each subagent is allowed to call. Constrained to read-only web +
 * filesystem reads — no edits, no shell, no git, so a runaway subagent
 * can't damage the working tree. WebSearch / WebFetch may be exposed
 * under different names depending on plugin configuration; the registry
 * silently ignores unknown names, so listing both common spellings is
 * harmless.
 */
export const SUBAGENT_ALLOWED_TOOLS = [
  'WebSearch',
  'WebFetch',
  'web_search',
  'web_fetch',
  'Read',
  'read',
] as const;
