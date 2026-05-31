import { defineMode, definePlugin } from '@moxxy/sdk';

import { GOAL_MODE_NAME } from './constants.js';
import { goalTools } from './goal-tools.js';
import { runGoalMode } from './goal-loop.js';

export { GOAL_MODE_NAME } from './constants.js';

export const goalMode = defineMode({
  name: GOAL_MODE_NAME,
  description: 'Autonomous goal loop: works across many turns until it calls goal_complete (tools auto-approved)',
  run: runGoalMode,
});

export const goalModePlugin = definePlugin({
  name: '@moxxy/mode-goal',
  version: '0.0.0',
  // The mode AND its control tools ship together: the loop watches for the
  // tools' results to terminate, so they're useless apart.
  modes: [goalMode],
  tools: goalTools,
});

export default goalModePlugin;
