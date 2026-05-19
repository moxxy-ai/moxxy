import {
  defineLoopStrategy,
  definePlugin,
  type CollectedToolUse,
} from '@moxxy/sdk';

import { runToolUseLoop, TOOL_USE_LOOP_NAME } from './turn-iterator.js';

export { TOOL_USE_LOOP_NAME };
export type { CollectedToolUse };

export const toolUseLoop = defineLoopStrategy({
  name: TOOL_USE_LOOP_NAME,
  run: runToolUseLoop,
});

export const toolUseLoopPlugin = definePlugin({
  name: '@moxxy/loop-tool-use',
  version: '0.0.0',
  loopStrategies: [toolUseLoop],
});

export default toolUseLoopPlugin;
