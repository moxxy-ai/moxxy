import { defineMode, definePlugin } from '@moxxy/sdk';

import { RESEARCH_MODE_NAME } from './constants.js';
import { runDeepResearchMode } from './research-loop.js';

export { RESEARCH_MODE_NAME } from './constants.js';
export { parseFollowups, parseQueries } from './parse-queries.js';
export {
  buildFanoutDigest,
  buildSynthesisInput,
  flattenOutcome,
  type RoundFinding,
} from './fanout-phase.js';

export const deepResearchMode = defineMode({
  name: RESEARCH_MODE_NAME,
  description: 'Fan-out research: plan queries, run subagents in parallel, synthesise a report',
  run: runDeepResearchMode,
});

export const deepResearchModePlugin = definePlugin({
  name: '@moxxy/mode-deep-research',
  version: '0.0.0',
  modes: [deepResearchMode],
});

export default deepResearchModePlugin;
