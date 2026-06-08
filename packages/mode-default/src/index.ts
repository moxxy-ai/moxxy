import {
  defineMode,
  definePlugin,
  type CollectedToolUse,
} from '@moxxy/sdk';

import { runDefaultMode, DEFAULT_MODE_NAME } from './turn-iterator.js';

export { DEFAULT_MODE_NAME };
export type { CollectedToolUse };

export const defaultMode = defineMode({
  name: DEFAULT_MODE_NAME,
  description: 'Default ReAct-style loop: model thinks, calls tools, observes results, repeats',
  run: runDefaultMode,
});

export const defaultModePlugin = definePlugin({
  name: '@moxxy/mode-default',
  version: '0.0.0',
  modes: [defaultMode],
});

export default defaultModePlugin;
