import {
  runReactLoop,
  unfinishedStepCheckpoint,
  unfinishedWorkCheckpoint,
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
 * repeats — and returns the moment the model stops calling tools. Two gates on
 * that, each asked once in a turn: a report made while the last look at
 * something found work still under way is asked to look again (see
 * unfinishedWorkCheckpoint), and a turn that ended on a step that did not get
 * done is asked to take another way or name what stops it (see
 * unfinishedStepCheckpoint).
 */
const checkpoints = [unfinishedWorkCheckpoint(), unfinishedStepCheckpoint()];

export function runDefaultMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  return runReactLoop(ctx, { strategyName: DEFAULT_MODE_NAME, checkpoints });
}
