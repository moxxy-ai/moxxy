import { defineMode, definePlugin } from '@moxxy/sdk';

import { DEEP_RESEARCH_MODE_NAME } from './constants.js';
import { runDeepResearchMode } from './research-loop.js';

export { DEEP_RESEARCH_MODE_NAME } from './constants.js';
export { parseFollowups, parseQueries } from './parse-queries.js';
export {
  buildFanoutDigest,
  buildSynthesisInput,
  flattenOutcome,
  type RoundFinding,
} from './fanout-phase.js';

export const deepResearchMode = defineMode({
  name: DEEP_RESEARCH_MODE_NAME,
  description: 'Fan-out research: plan queries, run subagents in parallel, synthesise a report',
  run: runDeepResearchMode,
});

export const deepResearchModePlugin = definePlugin({
  name: '@moxxy/mode-deep-research',
  version: '0.0.0',
  modes: [deepResearchMode],
});

export default deepResearchModePlugin;
