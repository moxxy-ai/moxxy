import { defineMode, definePlugin } from '@moxxy/sdk';

import { DEVELOPER_MODE_NAME } from './constants.js';
import { runDeveloperMode } from './developer-loop.js';

export { DEVELOPER_MODE_NAME } from './constants.js';
export { parseVerify, formatCommitMessage } from './parse-verify.js';
export { collectChangedFiles, renderDiffBody } from './diff-preview.js';

export const developerMode = defineMode({
  name: DEVELOPER_MODE_NAME,
  run: runDeveloperMode,
});

export const developerModePlugin = definePlugin({
  name: '@moxxy/mode-developer',
  version: '0.0.0',
  modes: [developerMode],
});

export default developerModePlugin;
