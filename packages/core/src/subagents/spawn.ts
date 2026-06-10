/**
 * Back-compat entry point for the subagent runtime. The implementation lives
 * in `run-child.ts` (which adds retained-session `continue()`/`release()` for
 * the workflow `awaitInput` pause/resume flow); this module just re-exports it
 * so existing `subagents/spawn.js` importers keep working.
 */
export {
  createSubagentSpawner,
  runChildTurn,
  continueChildTurn,
  type SubagentRuntime,
} from './run-child.js';
