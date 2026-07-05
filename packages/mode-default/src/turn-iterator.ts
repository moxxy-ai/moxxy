import {
  runReactLoop,
  type ModeContext,
  type MoxxyEvent,
} from '@moxxy/sdk';

export const DEFAULT_MODE_NAME = 'default';

// The loop plumbing (bounded retry back-off, reactive compaction, elision,
// stuck detection, abort handling) lives in the SDK's shared ReAct core —
// re-export its constants/test seam so existing importers keep working.
export { MAX_CONSECUTIVE_RETRIES, __setRetrySleepForTests } from '@moxxy/sdk';

/**
 * Default ReAct-style loop: model thinks, calls tools, observes results,
 * repeats — and returns the moment the model stops calling tools. Pure
 * delegation to {@link runReactLoop} with no hooks and no checkpoints: the
 * shared core IS the default behavior; other modes layer policy on top.
 */
export function runDefaultMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  return runReactLoop(ctx, { strategyName: DEFAULT_MODE_NAME });
}
