import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createMutex } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import { z } from 'zod';
import type { AppElement, AppTree } from './tree.js';
import { pointsAtFocus } from './words.js';

/** What memory needs of a step; a runner's own steps carry more. */
export interface MemoryStep {
  readonly do: string;
  readonly target?: string;
  readonly key?: string;
  readonly expect?: string;
}

/** Steps of any runner, kept as they were written; a runner passes its own schema to check them on reading. */
const anyStep = z.object({ do: z.string() }).passthrough() as unknown as z.ZodType<MemoryStep>;

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
  /** Labels of the elements that appeared when the step worked: seeing them again verifies it without Jev. Empty: nothing repeats. */
  effect: z.array(z.string()).optional(),
  uses: z.number().int().positive(), at: z.number(),
});
const fileSchemaOf = <S extends MemoryStep>(step: z.ZodType<S>) => z.object({
  app: z.string(), targets: z.array(learnedTarget),
  routes: z.array(z.object({ goal: z.string(), steps: z.array(step).min(1), uses: z.number().int().positive(), at: z.number() })),
  /** Shipped targets that proved wrong on this computer. */
  ignored: z.array(z.object({ do: z.string(), target: z.string() })).default([]),
});
interface MemoryFile {
  readonly app: string;
  readonly targets: LearnedTarget[];
  readonly routes: LearnedRoute[];
  readonly ignored: Array<{ do: string; target: string }>;
}

export type LearnedTarget = z.infer<typeof learnedTarget>;
export interface LearnedRoute<S extends MemoryStep = MemoryStep> { readonly goal: string; readonly steps: S[]; readonly uses: number; readonly at: number }
export interface AppMemory { readonly targets: readonly LearnedTarget[]; readonly routes: readonly LearnedRoute[] }
export interface Lesson {
  readonly targets?: ReadonlyArray<Pick<LearnedTarget, 'do' | 'target' | 'key' | 'label' | 'way' | 'effect'>>;
  /** A whole run that reached its end. */
  readonly route?: { readonly goal: string; readonly steps: readonly MemoryStep[] };
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

/** What a step is remembered under: its target, or for a key what it was pressed for. */
export const targetOf = (step: MemoryStep): string | undefined =>
  step.target ?? (step.do === 'key' && step.key !== undefined && step.expect !== undefined ? `${step.key} ${step.expect}` : undefined);

const newest = <T extends { at: number }>(items: T[], limit: number) => items.sort((a, b) => b.at - a.at).slice(0, limit);

/** Without `-` and `.` at either end. A loop, since `/[-.]+$/` backtracks over every run of dashes. */
function trimDashesAndDots(text: string): string {
  const edge = (char: string | undefined) => char === '-' || char === '.';
  let start = 0;
  let end = text.length;
  while (start < end && edge(text[start])) start += 1;
  while (end > start && edge(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

const fileName = (app: string) => {
  const name = trimDashesAndDots(app.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')).slice(0, 60);
  return `${name || 'app'}-${createHash('sha256').update(app).digest('hex').slice(0, 8)}.json`;
};

async function readFileOf(directory: string, app: string, step: z.ZodType<MemoryStep> = anyStep): Promise<MemoryFile> {
  try {
    const parsed = fileSchemaOf(step).safeParse(JSON.parse(await readFile(join(directory, fileName(app)), 'utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // No file, or one that cannot be read: nothing learned.
  }
  return { app, targets: [], routes: [], ignored: [] };
}

const sameTarget = (a: { do: string; target: string }, b: { do: string; target: string }) => a.do === b.do && a.target === b.target;
const sameRoute = (a: { steps: readonly MemoryStep[] }, b: { steps: readonly MemoryStep[] }) => JSON.stringify(a.steps) === JSON.stringify(b.steps);

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

  /**
   * `directory` holds what this computer learned, one file per app (or site); `shipped`, read-only, what ships
   * with moxxy. `step` checks remembered routes, so a route written for another runner's steps is not offered.
   */
  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
    private readonly shipped?: string,
    private readonly step: z.ZodType<MemoryStep> = anyStep,
  ) {}

  async read(app: string): Promise<AppMemory> {
    const own = await readFileOf(this.directory, app, this.step);
    if (!this.shipped) return { targets: own.targets, routes: own.routes };
    const shipped = await readFileOf(this.shipped, app, this.step);
    return {
      targets: [...shipped.targets.filter((target) => !own.ignored.some((ignored) => sameTarget(ignored, target))), ...own.targets],
      routes: [...shipped.routes, ...own.routes.filter((route) => !shipped.routes.some((known) => sameRoute(known, route)))],
    };
  }

  private change(app: string, update: (file: MemoryFile) => MemoryFile | Promise<MemoryFile>): Promise<void> {
    return this.mutex.run(async () => {
      try {
        await write(this.directory, await update(await readFileOf(this.directory, app, this.step)));
      } catch {
        // Memory is a speed-up, never a reason for a run to fail.
      }
    });
  }

  /** A target that points at the focus is not kept: the focus is elsewhere next time. */
  learn(app: string, lesson: Lesson): Promise<void> {
    const at = this.now();
    const targets = (lesson.targets ?? []).filter((target) => !pointsAtFocus(target.target))
      .map((target) => ({ ...target, target: sameWords(target.target), uses: 1, at }));
    const routes = lesson.route ? [{ goal: lesson.route.goal, steps: [...lesson.route.steps], uses: 1, at }] : [];
    return this.change(app, (file) => merged(file, targets, routes));
  }

  /** A remembered target did not do its step: drop it here, and stop using the shipped one on this computer. */
  forget(app: string, step: { do: string; target: string }): Promise<void> {
    const wrong = { do: step.do, target: sameWords(step.target) };
    return this.change(app, async (file) => {
      const shipped = this.shipped ? (await readFileOf(this.shipped, app, this.step)).targets.some((known) => sameTarget(known, wrong)) : false;
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
  // An empty effect is a lesson of its own: the step leaves nothing that repeats.
  return own.length > 0 || effect?.length === 0 ? { ...rest, effect: own } : rest;
}

/**
 * Adds what the computer learned (`from`) to the lessons that ship with moxxy (`to`). Run by the moxxy team
 * after trying cases on their machines; returns the apps it wrote.
 */
export async function promote(from: string, to: string, step: z.ZodType<MemoryStep> = anyStep): Promise<string[]> {
  const files = (await readdir(from).catch(() => [])).filter((file) => file.endsWith('.json'));
  const apps: string[] = [];
  for (const file of files) {
    const parsed = fileSchemaOf(step).safeParse(JSON.parse(await readFile(join(from, file), 'utf8')));
    if (!parsed.success) continue;
    const { app, routes } = parsed.data;
    // What a key made appear is all of its lesson, and that stays on the computer.
    const targets = parsed.data.targets.filter((target) => target.label !== '').map(shippable);
    await write(to, { ...merged(await readFileOf(to, app, step), targets, routes), ignored: [] });
    apps.push(app);
  }
  return apps.sort();
}

/** The element a lesson is about, when the window still has it reading the same. */
function live(memory: AppMemory, known: LearnedTarget, tree: AppTree): { element: AppElement; way: number; effect?: readonly string[] } | undefined {
  const reading = tree.elements.filter((element) => labelOf(element) === known.label);
  const element = reading.find((candidate) => candidate.key === known.key) ?? (reading.length === 1 ? reading[0] : undefined);
  if (!element) return undefined;
  // A shipped lesson carries little of the effect; what this computer saw the same element do completes it.
  const effect = known.effect ?? memory.targets.find((other) => other.do === known.do && other.target === known.target && other.label === known.label && other.effect)?.effect;
  return { element, way: known.way, ...(effect ? { effect } : {}) };
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');

/**
 * The lesson a target written in other words is probably about: the one lesson whose element's name stands in
 * the target as words of its own. A guess, to be confirmed before it is used.
 */
export function guess(memory: AppMemory, step: MemoryStep, tree: AppTree): { element: AppElement; way: number; effect?: readonly string[] } | undefined {
  if (step.target === undefined) return undefined;
  const said = ` ${wordsOf(step.target)} `;
  const named = memory.targets.filter((known) => {
    const name = wordsOf(titleOf(known.label));
    return known.do === step.do && name !== '' && said.includes(` ${name} `);
  });
  if (new Set(named.map((known) => known.label)).size !== 1) return undefined;
  for (const known of named) {
    const found = live(memory, known, tree);
    if (found) return found;
  }
  return undefined;
}

/** The live element a step's target was last time, when the window still has it reading the same. */
export function recall(memory: AppMemory, step: MemoryStep, tree: AppTree): { element?: AppElement; way: number; effect?: readonly string[] } | undefined {
  const named = targetOf(step);
  // Lessons learned before these were left out still name the element the focus was in then.
  if (named === undefined || (step.target !== undefined && pointsAtFocus(step.target))) return undefined;
  const target = sameWords(named);
  if (step.target === undefined) {
    // A key has no element: all there is to remember is what it made appear.
    const effect = memory.targets.find((known) => known.do === step.do && known.target === target && known.effect)?.effect;
    return effect ? { way: 0, effect } : undefined;
  }
  for (const known of memory.targets) {
    if (known.do !== step.do || known.target !== target) continue;
    const found = live(memory, known, tree);
    if (found) return found;
  }
  return undefined;
}

/** Routes that worked before in this app (or site), for the main model to send again as they are through `tool`. */
export function describeRoutes(memory: AppMemory, tool: string, place = 'app'): string | undefined {
  const routes = [...memory.routes].sort((a, b) => b.uses - a.uses || b.at - a.at).slice(0, ROUTES_SHOWN);
  if (routes.length === 0) return undefined;
  const lines = routes.map((route) => `- ${route.goal}: ${JSON.stringify(route.steps)}`);
  return `Routes that worked in this ${place} before (send the steps unchanged in one ${tool} when they fit the task; their elements are remembered, so they run fastest):\n${lines.join('\n')}`;
}
