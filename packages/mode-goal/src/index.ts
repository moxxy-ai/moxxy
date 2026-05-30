import { defineMode, definePlugin } from '@moxxy/sdk';

import { GOAL_MODE_NAME } from './constants.js';
import { runGoalMode } from './goal-loop.js';

export { GOAL_MODE_NAME } from './constants.js';
export { parseCompletion } from './parse-completion.js';

export const goalMode = defineMode({
  name: GOAL_MODE_NAME,
  description: 'Works autonomously, re-checking until the objective is verifiably delivered (interrupt anytime)',
  run: runGoalMode,
});

export const goalModePlugin = definePlugin({
  name: '@moxxy/mode-goal',
  version: '0.0.0',
  modes: [goalMode],
});

export default goalModePlugin;
