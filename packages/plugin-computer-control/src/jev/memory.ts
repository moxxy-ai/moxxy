import { fileURLToPath } from 'node:url';
import { RunMemory as SharedMemory, describeRoutes as describeShared, promote as promoteShared, type AppMemory } from '@moxxy/jev';
import { moxxyPath } from '@moxxy/sdk/server';
import { runStepShape } from '../contract/tools.js';

export { guess, labelOf, recall, sameWords, targetOf, type AppMemory, type LearnedRoute, type LearnedTarget, type Lesson } from '@moxxy/jev';

/** What the moxxy team learned and ships with the plugin, so a new install does not start from nothing. */
export const shippedLearned = fileURLToPath(new URL('../../learned', import.meta.url));

/** Computer Use's lessons: one file per app under `~/.moxxy/computer-use/learned`, routes of computer_run steps. */
export class RunMemory extends SharedMemory {
  constructor(directory: string = moxxyPath('computer-use', 'learned'), now: () => number = Date.now, shipped?: string) {
    super(directory, now, shipped, runStepShape);
  }
}

export const describeRoutes = (memory: AppMemory): string | undefined => describeShared(memory, 'computer_run');

export const promote = (from: string, to: string): Promise<string[]> => promoteShared(from, to, runStepShape);
