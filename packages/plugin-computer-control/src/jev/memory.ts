import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { z } from 'zod';
import { runStepShape, type RunStep } from '../contract/tools.js';
import type { AppElement, AppTree } from '../contract/tree.js';

/** Lessons kept per app; the oldest go first. */
const MAX_TARGETS = 200;
const MAX_ROUTES = 20;
/** Routes shown to the main model with an app's first state. */
const ROUTES_SHOWN = 5;

const learnedTarget = z.object({
  do: z.string(), target: z.string(),
  /** The element's place in the window and what it read (role and title) when the step worked on it. */
  key: z.string(), label: z.string(),
  /** Which of the step's ways worked, counted from 0. */
  way: z.number().int().nonnegative(),
  /** Labels of the elements that appeared when the step worked: seeing them again verifies it without Jev. */
  effect: z.array(z.string()).optional(),
  uses: z.number().int().positive(), at: z.number(),
});
const learnedRoute = z.object({ goal: z.string(), steps: z.array(runStepShape).min(1), uses: z.number().int().positive(), at: z.number() });
const fileSchema = z.object({ app: z.string(), targets: z.array(learnedTarget), routes: z.array(learnedRoute) });

export type LearnedTarget = z.infer<typeof learnedTarget>;
export type LearnedRoute = z.infer<typeof learnedRoute>;
export interface AppMemory { readonly targets: readonly LearnedTarget[]; readonly routes: readonly LearnedRoute[] }
export interface Lesson {
  readonly targets?: ReadonlyArray<Pick<LearnedTarget, 'do' | 'target' | 'key' | 'label' | 'way' | 'effect'>>;
  /** A whole run that reached its end. */
  readonly route?: { readonly goal: string; readonly steps: readonly RunStep[] };
}

const EMPTY: AppMemory = { targets: [], routes: [] };

/** A target as the model wrote it, without the differences that do not matter. */
export const sameWords = (target: string) => target.trim().replace(/\s+/g, ' ').toLowerCase();
export const labelOf = (element: Pick<AppElement, 'role' | 'title'>) => `${element.role}\u001f${element.title ?? ''}`;

const newest = <T extends { at: number }>(items: T[], limit: number) => items.sort((a, b) => b.at - a.at).slice(0, limit);

/**
 * What runs of steps taught about each app, on this computer: which element a described target was, which way of
 * acting worked, and whole routes that reached their end. A lesson that cannot be read or written is skipped;
 * a run never fails because of its memory.
 */
export class RunMemory {
  private readonly mutex = createMutex();

  constructor(private readonly directory: string = moxxyPath('computer-use', 'learned'), private readonly now: () => number = Date.now) {}

  private file(app: string): string {
    const name = app.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
    return join(this.directory, `${name || 'app'}-${createHash('sha256').update(app).digest('hex').slice(0, 8)}.json`);
  }

  async read(app: string): Promise<AppMemory> {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(this.file(app), 'utf8')));
      return parsed.success ? { targets: parsed.data.targets, routes: parsed.data.routes } : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  private change(app: string, update: (memory: AppMemory) => AppMemory): Promise<void> {
    return this.mutex.run(async () => {
      try {
        const next = update(await this.read(app));
        await mkdir(this.directory, { recursive: true });
        await writeFileAtomic(this.file(app), `${JSON.stringify({ app, ...next }, null, 1)}\n`);
      } catch {
        // Memory is a speed-up, never a reason for a run to fail.
      }
    });
  }

  learn(app: string, lesson: Lesson): Promise<void> {
    const at = this.now();
    return this.change(app, (memory) => {
      const targets = [...memory.targets];
      for (const learned of lesson.targets ?? []) {
        const target = sameWords(learned.target);
        const index = targets.findIndex((known) => known.do === learned.do && known.target === target);
        const uses = (targets[index]?.uses ?? 0) + 1;
        if (index >= 0) targets.splice(index, 1);
        targets.push({ ...learned, target, uses, at });
      }
      const routes = [...memory.routes];
      if (lesson.route) {
        const steps = JSON.stringify(lesson.route.steps);
        const index = routes.findIndex((known) => JSON.stringify(known.steps) === steps);
        const uses = (routes[index]?.uses ?? 0) + 1;
        if (index >= 0) routes.splice(index, 1);
        routes.push({ goal: lesson.route.goal, steps: [...lesson.route.steps], uses, at });
      }
      return { targets: newest(targets, MAX_TARGETS), routes: newest(routes, MAX_ROUTES) };
    });
  }

  forget(app: string, step: { do: string; target: string }): Promise<void> {
    const target = sameWords(step.target);
    return this.change(app, (memory) => ({ ...memory, targets: memory.targets.filter((known) => !(known.do === step.do && known.target === target)) }));
  }
}

/** The live element a step's target was last time, when the window still has it reading the same. */
export function recall(memory: AppMemory, step: RunStep, tree: AppTree): { element: AppElement; way: number; effect?: readonly string[] } | undefined {
  if (step.target === undefined) return undefined;
  const target = sameWords(step.target);
  const known = memory.targets.find((learned) => learned.do === step.do && learned.target === target);
  if (!known) return undefined;
  const reading = tree.elements.filter((element) => labelOf(element) === known.label);
  const element = reading.find((candidate) => candidate.key === known.key) ?? (reading.length === 1 ? reading[0] : undefined);
  return element ? { element, way: known.way, ...(known.effect ? { effect: known.effect } : {}) } : undefined;
}

/** Routes that worked before in this app, for the main model to send again as they are. */
export function describeRoutes(memory: AppMemory): string | undefined {
  const routes = [...memory.routes].sort((a, b) => b.uses - a.uses || b.at - a.at).slice(0, ROUTES_SHOWN);
  if (routes.length === 0) return undefined;
  const lines = routes.map((route) => `- ${route.goal}: ${JSON.stringify(route.steps)}`);
  return `Routes that worked in this app before (send the steps unchanged in one computer_run when they fit the task; their elements are remembered, so they run fastest):\n${lines.join('\n')}`;
}
