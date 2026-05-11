import { definePlugin, type ToolDef } from '@moxxy/sdk';
import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';

export { bashTool, editTool, globTool, grepTool, readTool, writeTool };

export const builtinTools: ReadonlyArray<ToolDef> = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  globTool,
];

export const builtinToolsPlugin = definePlugin({
  name: '@moxxy/tools-builtin',
  version: '0.0.0',
  tools: [...builtinTools],
});

export default builtinToolsPlugin;
