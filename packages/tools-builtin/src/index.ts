import { definePlugin, type ToolDef } from '@moxxy/sdk';
import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readTool } from './read.js';
import { recallTool } from './recall.js';
import { backgroundJobs } from './jobs.js';
import { sleepTool } from './sleep.js';
import { stopJobTool } from './stop-job.js';
import { waitTool } from './wait.js';
import { writeTool } from './write.js';

export { bashTool, editTool, globTool, grepTool, readTool, recallTool, sleepTool, stopJobTool, waitTool, writeTool };

// dispatch_agent moved to @moxxy/plugin-subagents so subagent support
// is itself a swappable block. Without that plugin installed, the model
// can't spawn children and the normal single-loop flow runs as usual.

export const builtinTools: ReadonlyArray<ToolDef> = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  globTool,
  recallTool,
  sleepTool,
  waitTool,
  stopJobTool,
];

export const builtinToolsPlugin = definePlugin({
  name: '@moxxy/tools-builtin',
  version: '0.0.0',
  tools: [...builtinTools],
  hooks: {
    // A background job belongs to its conversation; it must not outlive it.
    onShutdown: (ctx) => backgroundJobs.stopSession(String(ctx.sessionId)),
  },
});

export default builtinToolsPlugin;
