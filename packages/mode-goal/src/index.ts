import { defineMode, definePlugin } from '@moxxy/sdk';

import { GOAL_MODE_NAME } from './constants.js';
import { goalTools } from './goal-tools.js';
import { runGoalMode } from './goal-loop.js';

export { GOAL_MODE_NAME } from './constants.js';

export const goalMode = defineMode({
  name: GOAL_MODE_NAME,
  description:
    'Autonomous goal run: works until it calls goal_complete (tools auto-approved), then hands back to your previous mode',
  // Goal mode auto-approves tools and keeps working unattended, so channels
  // surface a persistent accent badge while it's active — the user must always
  // know the agent is driving itself.
  badge: { label: 'GOAL', tone: 'attention' },
  // One-shot: armed per objective, disarms itself when the goal concludes,
  // and is never persisted as the boot/category default — `/goal` once must
  // not make every future session autonomous.
  transient: true,
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
