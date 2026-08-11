import {
  runReactLoop,
  type ModeContext,
  type MoxxyEvent,
  type ToolRegistry,
  type TurnCheckpoint,
} from '@moxxy/sdk';

import {
  PLAN_COMPLETE_TOOL,
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
    run: async () => ({ action: 'inject', volatile: true, text: PLAN_COMPLETION_NUDGE }),
  };

  yield* runReactLoop(planCtx, {
    strategyName: PLAN_MODE_NAME,
    checkpoints: [requireStructuredPlan],
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
  });
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
