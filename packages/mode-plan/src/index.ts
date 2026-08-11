import { defineMode, definePlugin } from '@moxxy/sdk';

import { PLAN_MODE_NAME } from './constants.js';
import { runPlanMode } from './plan-loop.js';

export { PLAN_MODE_NAME } from './constants.js';
export { formatPlan } from './completion.js';
export { planDefinitionSchema, type PlanDefinition } from './plan-tool.js';

export const planMode = defineMode({
  name: PLAN_MODE_NAME,
  description: 'Read-only analysis that turns a request into a detailed, revisable execution plan',
  run: runPlanMode,
});

export const planModePlugin = definePlugin({
  name: '@moxxy/mode-plan',
  version: '0.0.0',
  modes: [planMode],
});

export default planModePlugin;
