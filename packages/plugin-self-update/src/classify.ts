import type { EventLogReader } from '@moxxy/sdk';

/**
 * Request classification for self-update. The *signals* are gathered
 * deterministically here; the *decision* is advisory — the orchestrating
 * skill makes the final call. This keeps mechanical inspection in code and
 * judgement in the prompt (mirroring how self-improver splits the two).
 */

export type Tier = 'skill' | 'plugin' | 'core';

export interface ClassifyInput {
  readonly trigger: 'error' | 'request';
  readonly text?: string;
}

export interface ClassifySignals {
  readonly failedTools: ReadonlyArray<string>;
  readonly errorMessages: ReadonlyArray<string>;
  readonly registeredTools: ReadonlyArray<string>;
}

export interface ClassifyResult {
  readonly tier: Tier;
  readonly candidateName?: string;
  readonly evidence: ReadonlyArray<string>;
  readonly rationale: string;
}

const CORE_HINTS = [
  '@moxxy/core',
  'packages/core',
  'core/src',
  'run-turn',
  'session.ts',
  'event log',
  'new event type',
  'loop strategy internals',
  'registry internals',
];

const SKILL_HINTS = [
  'always',
  'whenever',
  'every time',
  'remember to',
  'before you',
  'workflow',
  'procedure',
  'instruction',
];

const PLUGIN_HINTS = [
  'add a tool',
  'new tool',
  'integrate',
  'integration',
  'connect to',
  'call the',
  ' api',
  'command that',
  'wrap',
  'override',
];

/** Gather deterministic signals from the session event log. */
export function gatherSignals(
  log: EventLogReader,
  registeredTools: ReadonlyArray<string>,
  lookback = 40,
): ClassifySignals {
  const callNames = new Map<string, string>();
  for (const e of log.ofType('tool_call_requested')) {
    callNames.set(String(e.callId), e.name);
  }
  const recent = log.slice(Math.max(0, log.length - lookback));
  const failedTools = new Set<string>();
  const errorMessages: string[] = [];
  for (const e of recent) {
    if (e.type === 'tool_result' && !e.ok) {
      const name = callNames.get(String(e.callId));
      if (name) failedTools.add(name);
      if (e.error?.message) errorMessages.push(e.error.message);
    } else if (e.type === 'error') {
      errorMessages.push(e.message);
    }
  }
  return {
    failedTools: [...failedTools],
    errorMessages,
    registeredTools,
  };
}

function includesAny(haystack: string, needles: ReadonlyArray<string>): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n)) return n;
  }
  return null;
}

/** Suggest a kebab-case artifact name from free text. */
export function suggestName(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 4);
  return words.length > 0 ? words.join('-') : undefined;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'add',
  'can',
  'you',
  'please',
  'that',
  'this',
  'with',
  'make',
  'create',
  'want',
  'would',
  'like',
  'your',
]);

/**
 * Decide the lowest-risk tier that can satisfy the request, plus the evidence
 * behind that suggestion. Always advisory.
 */
export function classify(input: ClassifyInput, signals: ClassifySignals): ClassifyResult {
  const evidence: string[] = [];
  const blob = `${input.text ?? ''} ${signals.errorMessages.join(' ')}`;

  const coreHit = includesAny(blob, CORE_HINTS);
  if (coreHit) {
    evidence.push(`mentions core internals ("${coreHit}")`);
    return {
      tier: 'core',
      evidence,
      rationale:
        'The change appears to touch @moxxy/core internals — escalate to a Tier-2 core patch (build + overlay + restart). Confirm a plugin override cannot express it first.',
    };
  }

  // A referenced-but-unregistered capability ⇒ a new plugin/tool is needed.
  const missing = signals.failedTools.filter((t) => !signals.registeredTools.includes(t));
  if (missing.length > 0) {
    evidence.push(`failed call to unregistered tool(s): ${missing.join(', ')}`);
    return {
      tier: 'plugin',
      candidateName: suggestName(input.text) ?? missing[0],
      evidence,
      rationale:
        'A capability is missing. Author a new plugin (or install a published one) that provides the tool, then hot-reload.',
    };
  }

  // An existing tool misbehaved ⇒ usually instructions (skill) or a hook wrapper.
  if (signals.failedTools.length > 0) {
    evidence.push(`registered tool(s) misbehaved: ${signals.failedTools.join(', ')}`);
    const pluginHit = includesAny(blob, PLUGIN_HINTS);
    if (pluginHit) {
      evidence.push(`request implies a behavior override ("${pluginHit}")`);
      return {
        tier: 'plugin',
        candidateName: suggestName(input.text),
        evidence,
        rationale:
          'An existing tool misbehaves and the fix is a behavior change — wrap it in a plugin (onToolResult / onToolCall) rather than editing core.',
      };
    }
    return {
      tier: 'skill',
      candidateName: suggestName(input.text),
      evidence,
      rationale:
        'The tool exists but was used wrongly — a skill that encodes the correct procedure is the lowest-risk fix.',
    };
  }

  // No error signal: classify the free-text request.
  const skillHit = includesAny(blob, SKILL_HINTS);
  const pluginHit = includesAny(blob, PLUGIN_HINTS);
  if (pluginHit && !skillHit) {
    evidence.push(`request implies a new capability ("${pluginHit}")`);
    return {
      tier: 'plugin',
      candidateName: suggestName(input.text),
      evidence,
      rationale: 'The request asks for a new action/capability — author a plugin tool and hot-reload.',
    };
  }
  if (skillHit) {
    evidence.push(`request describes a procedure ("${skillHit}")`);
    return {
      tier: 'skill',
      candidateName: suggestName(input.text),
      evidence,
      rationale: 'The request is a recurring procedure expressible with existing tools — author a skill.',
    };
  }

  // Default for an unqualified "add XYZ": prefer a plugin (capability), the
  // common case, but the skill should reconsider a skill if no code is needed.
  evidence.push('no strong signal; defaulting to the plugin tier');
  return {
    tier: 'plugin',
    candidateName: suggestName(input.text),
    evidence,
    rationale:
      'Ambiguous request. Default to authoring a plugin; if the change needs no new code (only instructions), drop to the skill tier instead.',
  };
}
