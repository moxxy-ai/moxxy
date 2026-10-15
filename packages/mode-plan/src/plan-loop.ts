import {
  runReactLoop,
  type ModeContext,
  type MoxxyEvent,
  type ToolRegistry,
  type TurnCheckpoint,
} from '@moxxy/sdk';

import {
  PLAN_COMPLETE_TOOL,
  AGENT_PLAN_HAND_OFF_NUDGE,
  PLAN_COMPLETION_NUDGE,
  PLAN_MODE_NAME,
  PLAN_PLUGIN_ID,
  PLAN_SYSTEM_PROMPT,
} from './constants.js';
import { detectCompletedPlan, formatPlan } from './completion.js';
import { acknowledgePlan, planCompleteTool } from './plan-tool.js';

const READ_ONLY_TOOLS = new Set([
  PLAN_COMPLETE_TOOL,
  'Read',
  'Grep',
  'Glob',
  'recall',
  'session_recall',
  'memory_recall',
  'memory_list',
  'load_skill',
  'web_search',
  'web_fetch',
  'ask_user',
]);

export async function* runPlanMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  const planCtx: ModeContext = {
    ...ctx,
    systemPrompt: composeSystemPrompts(ctx.systemPrompt, PLAN_SYSTEM_PROMPT),
    tools: readOnlyTools(ctx.tools),
  };

  const requireStructuredPlan: TurnCheckpoint = {
    name: 'plan-complete',
    gateOn: 'idle',
    // An agent with its own plan mode hands its plan back itself (`onAgentPlan`).
    agentConnections: true,
    applies: (loopCtx) => loopCtx.provider.agentOwns?.plan !== true,
    run: async () => ({ action: 'inject', volatile: true, text: PLAN_COMPLETION_NUDGE }),
  };

  // An agent with its own plan mode may still write its plan as a message, which leaves no card to
  // answer it on. It is asked once a turn to hand the plan over its own way.
  let askedForHandOff = false;
  const handOverAgentPlan: TurnCheckpoint = {
    name: 'agent-plan-hand-off',
    gateOn: 'idle',
    agentConnections: true,
    applies: (loopCtx) => loopCtx.provider.agentOwns?.plan === true && !askedForHandOff,
    run: async (check) => {
      if (!looksLikePlan(check.candidateText)) return { action: 'pass' };
      askedForHandOff = true;
      return { action: 'inject', volatile: true, text: AGENT_PLAN_HAND_OFF_NUDGE };
    },
  };

  yield* runReactLoop(planCtx, {
    strategyName: PLAN_MODE_NAME,
    checkpoints: [requireStructuredPlan, handOverAgentPlan],
    maxInjections: 2,
    onToolBatchEnd: async (loopCtx, { toolUses }) => {
      if (!toolUses.some((tool) => tool.name === PLAN_COMPLETE_TOOL)) return undefined;
      const plan = detectCompletedPlan(loopCtx.log.slice(), toolUses);
      if (!plan) return undefined;

      await loopCtx.emit({
        type: 'plugin_event',
        sessionId: loopCtx.sessionId,
        turnId: loopCtx.turnId,
        source: 'plugin',
        pluginId: PLAN_PLUGIN_ID,
        subtype: 'plan_completed',
        payload: {
          title: plan.title,
          steps: plan.steps.length,
          recommendedMode: plan.recommendedMode,
          questions: plan.questions?.length ?? 0,
        },
      });
      await loopCtx.emit({
        type: 'assistant_message',
        sessionId: loopCtx.sessionId,
        turnId: loopCtx.turnId,
        source: 'system',
        content: formatPlan(plan),
        stopReason: 'end_turn',
      });
      return { action: 'stop' };
    },
    // An agent connection plans in its own plan mode and hands back Markdown:
    // the same card, without the step count or mode the structured plan has.
    onAgentPlan: async (loopCtx, plan) => {
      await loopCtx.emit({
        type: 'plugin_event',
        sessionId: loopCtx.sessionId,
        turnId: loopCtx.turnId,
        source: 'plugin',
        pluginId: PLAN_PLUGIN_ID,
        subtype: 'plan_completed',
        payload: { title: agentPlanTitle(plan), questions: 0 },
      });
      await loopCtx.emit({
        type: 'assistant_message',
        sessionId: loopCtx.sessionId,
        turnId: loopCtx.turnId,
        source: 'system',
        content: plan,
        stopReason: 'end_turn',
      });
      return { action: 'stop' };
    },
  });
}

/** A message laid out as a plan: under a heading, or three or more listed steps. */
export function looksLikePlan(text: string): boolean {
  if (/^#{1,6}\s+\S/m.test(text)) return true;
  return (text.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm) ?? []).length >= 3;
}

/** The plan's first heading, without a leading `Plan:` (Codex writes `## Plan: <title>`). */
export function agentPlanTitle(plan: string): string {
  const heading = /^#{1,6}\s+(.+?)\s*$/m.exec(plan)?.[1];
  if (!heading) return 'Plan';
  return heading.replace(/^plan\s*[:—–-]\s*/i, '').trim() || 'Plan';
}

export function readOnlyTools(tools: ToolRegistry): ToolRegistry {
  const allowed = (name: string): boolean => READ_ONLY_TOOLS.has(name);
  return {
    list: () => [
      ...tools.list().filter((tool) => allowed(tool.name) && tool.name !== PLAN_COMPLETE_TOOL),
      planCompleteTool,
    ],
    get: (name) => {
      if (name === PLAN_COMPLETE_TOOL) return planCompleteTool;
      return allowed(name) ? tools.get(name) : undefined;
    },
    execute: async (name, input, signal, opts) => {
      if (!allowed(name)) throw new Error(`plan mode does not allow the mutating tool "${name}"`);
      if (name === PLAN_COMPLETE_TOOL) return acknowledgePlan(input);
      return tools.execute(name, input, signal, opts);
    },
  };
}

function composeSystemPrompts(base: string | undefined, addition: string): string {
  return base ? `${base}\n\n${addition}` : addition;
}
