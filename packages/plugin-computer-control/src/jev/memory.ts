import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const fileSchema = z.object({
  app: z.string(), targets: z.array(learnedTarget), routes: z.array(learnedRoute),
  /** Shipped targets that proved wrong on this computer. */
  ignored: z.array(z.object({ do: z.string(), target: z.string() })).default([]),
});
type MemoryFile = z.infer<typeof fileSchema>;

/** What the moxxy team learned and ships with the plugin, so a new install does not start from nothing. */
export const shippedLearned = fileURLToPath(new URL('../../learned', import.meta.url));

export type LearnedTarget = z.infer<typeof learnedTarget>;
export type LearnedRoute = z.infer<typeof learnedRoute>;
export interface AppMemory { readonly targets: readonly LearnedTarget[]; readonly routes: readonly LearnedRoute[] }
export interface Lesson {
  readonly targets?: ReadonlyArray<Pick<LearnedTarget, 'do' | 'target' | 'key' | 'label' | 'way' | 'effect'>>;
  /** A whole run that reached its end. */
  readonly route?: { readonly goal: string; readonly steps: readonly RunStep[] };
}

/** A target as the model wrote it, without the differences that do not matter. */
/** Words that change with the writer and not with the element meant. */
const ARTICLES = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'item']);
export function sameWords(target: string): string {
  const words = target.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const telling = words.filter((word) => !ARTICLES.has(word));
  return (telling.length > 0 ? telling : words).join(' ');
}
/** A toolbar button often has no title, only a description. */
export const labelOf = (element: Pick<AppElement, 'role' | 'title' | 'description'>) => `${element.role}\u001f${element.title ?? element.description ?? ''}`;

const newest = <T extends { at: number }>(items: T[], limit: number) => items.sort((a, b) => b.at - a.at).slice(0, limit);

const fileName = (app: string) => {
  const name = app.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return `${name || 'app'}-${createHash('sha256').update(app).digest('hex').slice(0, 8)}.json`;
};

async function readFileOf(directory: string, app: string): Promise<MemoryFile> {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(await readFile(join(directory, fileName(app)), 'utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // No file, or one that cannot be read: nothing learned.
  }
  return { app, targets: [], routes: [], ignored: [] };
}

const sameTarget = (a: { do: string; target: string }, b: { do: string; target: string }) => a.do === b.do && a.target === b.target;
const sameRoute = (a: { steps: readonly RunStep[] }, b: { steps: readonly RunStep[] }) => JSON.stringify(a.steps) === JSON.stringify(b.steps);

/** `added` on top of `kept`: the same target or route is replaced and its uses add up. */
function merged(kept: MemoryFile, targets: readonly LearnedTarget[], routes: readonly LearnedRoute[]): MemoryFile {
  const nextTargets = [...kept.targets];
  for (const target of targets) {
    const index = nextTargets.findIndex((known) => sameTarget(known, target));
    const uses = (nextTargets[index]?.uses ?? 0) + target.uses;
    if (index >= 0) nextTargets.splice(index, 1);
    nextTargets.push({ ...target, uses });
  }
  const nextRoutes = [...kept.routes];
  for (const route of routes) {
    const index = nextRoutes.findIndex((known) => sameRoute(known, route));
    const uses = (nextRoutes[index]?.uses ?? 0) + route.uses;
    if (index >= 0) nextRoutes.splice(index, 1);
    nextRoutes.push({ ...route, uses });
  }
  return { ...kept, targets: newest(nextTargets, MAX_TARGETS), routes: newest(nextRoutes, MAX_ROUTES) };
}

const write = async (directory: string, file: MemoryFile) => {
  await mkdir(directory, { recursive: true });
  const { ignored, ...rest } = file;
  await writeFileAtomic(join(directory, fileName(file.app)), `${JSON.stringify(ignored.length > 0 ? file : rest, null, 1)}\n`);
};

/**
 * What runs of steps taught about each app: which element a described target was, which way of acting worked,
 * and whole routes that reached their end. Read first from what ships with moxxy, then from what this computer
 * learned; only the latter is written. A lesson that cannot be read or written is skipped; a run never fails
 * because of its memory.
 */
export class RunMemory {
  private readonly mutex = createMutex();

  constructor(
    private readonly directory: string = moxxyPath('computer-use', 'learned'),
    private readonly now: () => number = Date.now,
    private readonly shipped?: string,
  ) {}

  async read(app: string): Promise<AppMemory> {
    const own = await readFileOf(this.directory, app);
    if (!this.shipped) return { targets: own.targets, routes: own.routes };
    const shipped = await readFileOf(this.shipped, app);
    return {
      targets: [...shipped.targets.filter((target) => !own.ignored.some((ignored) => sameTarget(ignored, target))), ...own.targets],
      routes: [...shipped.routes, ...own.routes.filter((route) => !shipped.routes.some((known) => sameRoute(known, route)))],
    };
  }

  private change(app: string, update: (file: MemoryFile) => MemoryFile | Promise<MemoryFile>): Promise<void> {
    return this.mutex.run(async () => {
      try {
        await write(this.directory, await update(await readFileOf(this.directory, app)));
      } catch {
        // Memory is a speed-up, never a reason for a run to fail.
      }
    });
  }

  learn(app: string, lesson: Lesson): Promise<void> {
    const at = this.now();
    const targets = (lesson.targets ?? []).map((target) => ({ ...target, target: sameWords(target.target), uses: 1, at }));
    const routes = lesson.route ? [{ goal: lesson.route.goal, steps: [...lesson.route.steps], uses: 1, at }] : [];
    return this.change(app, (file) => merged(file, targets, routes));
  }

  /** A remembered target did not do its step: drop it here, and stop using the shipped one on this computer. */
  forget(app: string, step: { do: string; target: string }): Promise<void> {
    const wrong = { do: step.do, target: sameWords(step.target) };
    return this.change(app, async (file) => {
      const shipped = this.shipped ? (await readFileOf(this.shipped, app)).targets.some((known) => sameTarget(known, wrong)) : false;
      const ignored = shipped && !file.ignored.some((known) => sameTarget(known, wrong)) ? [...file.ignored, wrong] : file.ignored;
      return { ...file, targets: file.targets.filter((known) => !sameTarget(known, wrong)), ignored };
    });
  }
}

const titleOf = (label: string) => label.slice(label.indexOf('\u001f') + 1);

/** A target as it may leave the computer: of its effect, only labels that repeat the element's own name. */
function shippable(target: LearnedTarget): LearnedTarget {
  const { effect, ...rest } = target;
  const own = (effect ?? []).filter((label) => titleOf(label) === titleOf(target.label));
  return own.length > 0 ? { ...rest, effect: own } : rest;
}

/**
 * Adds what the computer learned (`from`) to the lessons that ship with moxxy (`to`). Run by the moxxy team
 * after trying cases on their machines; returns the apps it wrote.
 */
export async function promote(from: string, to: string): Promise<string[]> {
  const files = (await readdir(from).catch(() => [])).filter((file) => file.endsWith('.json'));
  const apps: string[] = [];
  for (const file of files) {
    const parsed = fileSchema.safeParse(JSON.parse(await readFile(join(from, file), 'utf8')));
    if (!parsed.success) continue;
    const { app, routes } = parsed.data;
    await write(to, { ...merged(await readFileOf(to, app), parsed.data.targets.map(shippable), routes), ignored: [] });
    apps.push(app);
  }
  return apps.sort();
}

/** The live element a step's target was last time, when the window still has it reading the same. */
export function recall(memory: AppMemory, step: RunStep, tree: AppTree): { element: AppElement; way: number; effect?: readonly string[] } | undefined {
  if (step.target === undefined) return undefined;
  const target = sameWords(step.target);
  for (const known of memory.targets) {
    if (known.do !== step.do || known.target !== target) continue;
    const reading = tree.elements.filter((element) => labelOf(element) === known.label);
    const element = reading.find((candidate) => candidate.key === known.key) ?? (reading.length === 1 ? reading[0] : undefined);
    if (!element) continue;
    // A shipped lesson carries little of the effect; what this computer saw the same element do completes it.
    const effect = known.effect ?? memory.targets.find((other) => other.do === step.do && other.target === target && other.label === known.label && other.effect)?.effect;
    return { element, way: known.way, ...(effect ? { effect } : {}) };
  }
  return undefined;
}

/** Routes that worked before in this app, for the main model to send again as they are. */
export function describeRoutes(memory: AppMemory): string | undefined {
  const routes = [...memory.routes].sort((a, b) => b.uses - a.uses || b.at - a.at).slice(0, ROUTES_SHOWN);
  if (routes.length === 0) return undefined;
  const lines = routes.map((route) => `- ${route.goal}: ${JSON.stringify(route.steps)}`);
  return `Routes that worked in this app before (send the steps unchanged in one computer_run when they fit the task; their elements are remembered, so they run fastest):\n${lines.join('\n')}`;
}
