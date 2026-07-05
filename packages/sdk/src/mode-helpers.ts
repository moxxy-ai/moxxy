/**
 * Barrel for the shared mode/loop helpers. The implementations now live in
 * focused single-responsibility modules under `./mode/`; this file re-exports
 * them so every existing `from './mode-helpers.js'` import (and the
 * `@moxxy/sdk` index barrel) keeps working byte-identically.
 *
 *  - `./mode/project-messages.ts` — event-log → ProviderMessage projection
 *  - `./mode/collect-stream.ts`   — provider-stream collection
 *  - `./mode/single-shot.ts`      — single-shot (no-tools) provider turn
 *  - `./mode/stuck-loop.ts`       — sliding-window stuck-tool-call detector
 *  - `./mode/stable-hash.ts`      — key-order-canonical input hash util
 *  - `./mode/react-loop.ts`       — the shared ReAct loop core (+ checkpoint gate)
 *  - `./mode/checkpoint.ts`       — turn-end checkpoint contract
 */

export {
  ELISION_SYSTEM_NOTE,
  buildSystemPromptWithSkills,
  projectMessagesFromLog,
  projectMessages,
  type ProjectMessagesOptions,
  type ProjectedMessages,
} from './mode/project-messages.js';
export {
  collectProviderStream,
  type CollectedToolUse,
  type StreamResult,
} from './mode/collect-stream.js';
export { runSingleShotTurn } from './mode/single-shot.js';
export { sleepWithAbort, nextBackoffMs } from './mode/abort-backoff.js';
export {
  createStuckLoopDetector,
  type StuckLoopDetector,
  type StuckSignal,
  type LoopGuardSettings,
} from './mode/stuck-loop.js';
export { stableHash } from './mode/stable-hash.js';
export {
  runReactLoop,
  MAX_CONSECUTIVE_RETRIES,
  __setRetrySleepForTests,
  type ReactLoopOptions,
  type ProviderSuccessInfo,
  type ToolBatchInfo,
  type StopDirective,
} from './mode/react-loop.js';
export type {
  CheckpointContext,
  CheckpointResult,
  TurnCheckpoint,
} from './mode/checkpoint.js';
