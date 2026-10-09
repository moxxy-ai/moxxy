/** The update plan on disk, beside the rest of the self-update state. */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import type { AppUpdatePlan } from '@moxxy/desktop-ipc-contract';

const planSchema = z.object({
  id: z.string().min(1).max(100),
  createdAt: z.number(),
  route: z.enum(['hot', 'installer']),
  version: z.string().min(1).max(100),
  releaseUrl: z.string().url().max(2000).optional(),
  completes: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        id: z.enum(['app', 'installer', 'restart']),
        status: z.enum(['pending', 'running', 'done', 'failed']),
        error: z.string().optional(),
      }),
    )
    .max(16),
});

export interface UpdatePlanStore {
  /** The saved plan, or null when there is none or the file can't be read. */
  read(): Promise<AppUpdatePlan | null>;
  write(plan: AppUpdatePlan): Promise<void>;
  clear(): Promise<void>;
}

export function updatePlanPath(userDataDir: string): string {
  return path.join(userDataDir, 'app', 'update-plan.json');
}

export function createUpdatePlanStore(userDataDir: string): UpdatePlanStore {
  const file = updatePlanPath(userDataDir);
  return {
    read: async () => {
      try {
        const parsed = planSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    write: async (plan) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await writeFileAtomic(file, `${JSON.stringify(plan, null, 2)}\n`);
    },
    clear: () => fs.rm(file, { force: true }),
  };
}
