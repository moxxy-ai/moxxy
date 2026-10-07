import type { MoxxyEvent } from '@moxxy/sdk';

/**
 * What the plan, goal and research modes report about a turn besides its
 * messages, read into what the conversation draws.
 *
 * The modes say it as plugin events (see packages/mode-plan, mode-goal and
 * mode-deep-research). Everything here reads those payloads defensively: a
 * mode that changes what it reports costs a heading, never a crash.
 */

export type OutcomeKind =
  | 'plan'
  | 'goal-complete'
  | 'goal-paused'
  | 'goal-ended'
  | 'research-plan'
  | 'research-followup';

export interface OutcomeFact {
  readonly text: string;
  readonly tone?: 'warn';
}

/** The heading over the message that closes a piece of a mode's work. */
export interface ModeOutcome {
  readonly kind: OutcomeKind;
  readonly title: string;
  readonly tone: 'neutral' | 'good' | 'warn';
  readonly facts: ReadonlyArray<OutcomeFact>;
}

/** A line for a step neither side said: a round starting, a run steering itself. */
export interface ModeNote {
  readonly text: string;
  readonly tone: 'info' | 'good' | 'warn';
}

export interface ModeTranscript {
  /** By the id of the assistant message the heading belongs over. */
  readonly outcomes: ReadonlyMap<string, ModeOutcome>;
  /** By the id of the plugin event the line stands for. */
  readonly notes: ReadonlyMap<string, ModeNote>;
  /** A research agent's question, by its child session. */
  readonly agentTitles: ReadonlyMap<string, string>;
}

/**
 * The tools a mode calls only to say its work is done. What they say is drawn
 * as the card that follows, so the call itself is not a row of the conversation.
 */
export const MODE_SIGNAL_TOOLS: ReadonlySet<string> = new Set(['plan_complete', 'goal_complete', 'goal_abandon']);

type PluginEvent = Extract<MoxxyEvent, { type: 'plugin_event' }>;

const PLAN = '@moxxy/mode-plan';
const GOAL = '@moxxy/mode-goal';
const RESEARCH = '@moxxy/mode-deep-research';
const SUBAGENTS = '@moxxy/subagents';

/** The plugins whose events this module reads. */
export const MODE_PLUGIN_IDS: ReadonlyArray<string> = [PLAN, GOAL, RESEARCH];

const MODE_LABEL: Record<string, string> = { default: 'Default', goal: 'Goal' };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function outcomeFor(event: PluginEvent): ModeOutcome | null {
  const payload = record(event.payload);
  if (event.pluginId === PLAN && event.subtype === 'plan_completed') {
    const steps = count(payload.steps);
    const questions = count(payload.questions) ?? 0;
    const mode = typeof payload.recommendedMode === 'string' ? MODE_LABEL[payload.recommendedMode] : undefined;
    const facts: OutcomeFact[] = [];
    if (steps !== null) facts.push({ text: plural(steps, 'step') });
    if (questions > 0) facts.push({ text: `${plural(questions, 'decision')} needed`, tone: 'warn' });
    if (mode !== undefined) facts.push({ text: `Suggests ${mode} mode` });
    return { kind: 'plan', title: 'Plan', tone: 'neutral', facts };
  }
  if (event.pluginId === GOAL) {
    const iterations = count(payload.iterations);
    const facts = iterations === null ? [] : [{ text: plural(iterations, 'step') }];
    if (event.subtype === 'goal_completed') return { kind: 'goal-complete', title: 'Goal complete', tone: 'good', facts };
    if (event.subtype === 'goal_abandoned') {
      return { kind: 'goal-paused', title: 'Goal paused, it needs you', tone: 'warn', facts };
    }
    if (event.subtype === 'goal_stalled') return { kind: 'goal-ended', title: 'Goal run ended', tone: 'neutral', facts };
    return null;
  }
  if (event.pluginId === RESEARCH) {
    if (event.subtype === 'deep_research_queries_drafted') {
      const queries = strings(payload.queries).length;
      return {
        kind: 'research-plan',
        title: 'Research plan',
        tone: 'neutral',
        facts: queries > 0 ? [{ text: plural(queries, 'question') }] : [],
      };
    }
    if (event.subtype === 'deep_research_followups_drafted') {
      const round = count(payload.round);
      const kept = count(payload.kept) ?? strings(payload.queries).length;
      return {
        kind: 'research-followup',
        title: round === null ? 'Follow-up' : `Follow-up, round ${round}`,
        tone: 'neutral',
        facts: kept > 0 ? [{ text: plural(kept, 'question') }] : [],
      };
    }
  }
  return null;
}

function noteFor(event: PluginEvent): ModeNote | null {
  const payload = record(event.payload);
  if (event.pluginId === GOAL) {
    if (event.subtype === 'goal_started') {
      return { text: 'Goal run started. Tool calls are approved automatically.', tone: 'info' };
    }
    if (event.subtype === 'goal_stuck') {
      const tool = typeof payload.tool === 'string' ? payload.tool : 'A tool';
      const times = count(payload.count);
      const repeated = times === null ? `${tool} kept repeating` : `${tool} ran ${times} times`;
      return { text: `${repeated} with the same result. Trying another way.`, tone: 'warn' };
    }
    return null;
  }
  if (event.pluginId !== RESEARCH) return null;
  if (event.subtype === 'deep_research_fanout_started') {
    const round = count(payload.round);
    const queries = count(payload.queries);
    if (round === null || queries === null) return { text: 'Researching.', tone: 'info' };
    return { text: `Round ${round}. Researching ${plural(queries, 'question')}.`, tone: 'info' };
  }
  if (event.subtype === 'deep_research_followups_none') {
    return { text: 'No more questions to follow up.', tone: 'info' };
  }
  if (event.subtype === 'deep_research_synthesis_completed') {
    const findings = count(payload.totalFindings);
    const rounds = count(payload.rounds);
    const errored = count(payload.errored) ?? 0;
    if (findings === null || rounds === null) return { text: 'Research complete.', tone: 'good' };
    const failed = errored > 0 ? `, ${errored} failed` : '';
    return {
      text: `Research complete. ${plural(findings, 'finding')} over ${plural(rounds, 'round')}${failed}.`,
      tone: 'good',
    };
  }
  return null;
}

/** `subagent-3` is the third question of the round that is running. */
function researchQuestion(label: unknown, questions: ReadonlyArray<string>): string | null {
  if (typeof label !== 'string') return null;
  const match = /^subagent-(\d+)$/.exec(label);
  if (match === null) return null;
  return questions[Number(match[1]) - 1] ?? null;
}

export function readModeEvents(events: ReadonlyArray<MoxxyEvent>): ModeTranscript {
  const outcomes = new Map<string, ModeOutcome>();
  const notes = new Map<string, ModeNote>();
  const agentTitles = new Map<string, string>();
  // The heading waits for the next message of its own turn, and for no other.
  let pending: { readonly turnId: string; readonly outcome: ModeOutcome } | null = null;
  let questions: { readonly turnId: string; readonly list: ReadonlyArray<string> } | null = null;

  for (const event of events) {
    if (event.type === 'assistant_message') {
      if (pending !== null && pending.turnId === event.turnId) outcomes.set(event.id, pending.outcome);
      pending = null;
      continue;
    }
    if (event.type !== 'plugin_event') continue;
    if (event.pluginId === SUBAGENTS) {
      if (event.subtype !== 'subagent_started' || questions === null || questions.turnId !== event.turnId) continue;
      const payload = record(event.payload);
      const question = researchQuestion(payload.label, questions.list);
      if (question !== null && typeof payload.childSessionId === 'string') {
        agentTitles.set(payload.childSessionId, question);
      }
      continue;
    }
    const outcome = outcomeFor(event);
    if (outcome !== null) {
      pending = { turnId: event.turnId, outcome };
      if (event.pluginId === RESEARCH) {
        questions = { turnId: event.turnId, list: strings(record(event.payload).queries) };
      }
      continue;
    }
    const note = noteFor(event);
    if (note !== null) notes.set(event.id, note);
  }
  return { outcomes, notes, agentTitles };
}

const OPENINGS: Partial<Record<OutcomeKind, RegExp>> = {
  'goal-complete': /^✓ Goal complete — /,
  'goal-paused': /^Goal abandoned — /,
  'goal-ended': /^Goal run ended: /,
  'research-followup': /^Follow-up round \d+ — [^\n]*:\n/,
};

/**
 * The message under a heading, without the words the heading already says.
 * A message that does not open the way its mode writes it is left as it is.
 */
export function outcomeBody(kind: OutcomeKind, content: string): string {
  const opening = OPENINGS[kind];
  if (opening === undefined || !opening.test(content)) return content;
  const rest = content.replace(opening, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
