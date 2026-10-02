import { z } from 'zod';
import { runStepShape, type RunStep } from '../contract/tools.js';

/** The runs the moxxy team tries on an app before a release, so its lessons ship with the plugin. */
const casesSchema = z.object({
  app: z.string().min(1),
  cases: z.array(z.object({ goal: z.string().min(1), steps: z.array(runStepShape).min(1) }).strict()).min(1),
}).strict();
export type TrainingCases = z.infer<typeof casesSchema>;
export const parseCases = (raw: unknown): TrainingCases => casesSchema.parse(raw);

export interface CaseResult {
  readonly pass: number;
  readonly goal: string;
  /** Every step of the case was carried out. */
  readonly done: boolean;
  readonly seconds?: number;
  /** Requests to Jev: none once the case runs from its lessons. */
  readonly asked?: number;
  readonly why?: string;
}

const REPORT = /computer_run: (\d+) of (\d+) steps done in ([\d.]+) s \((\d+) Jev/;

/** Tries every case `passes` times through `run` (computer_run on a live app); the second pass shows what the first one taught. */
export async function train(file: TrainingCases, passes: number, run: (input: { app: string; goal: string; steps: RunStep[] }) => Promise<string>): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (let pass = 1; pass <= passes; pass += 1) {
    for (const { goal, steps } of file.cases) {
      try {
        const report = REPORT.exec(await run({ app: file.app, goal, steps }));
        results.push(report
          ? { pass, goal, done: report[1] === report[2], seconds: Number(report[3]), asked: Number(report[4]) }
          : { pass, goal, done: false, why: 'no run report' });
      } catch (error) {
        results.push({ pass, goal, done: false, why: String(error) });
      }
    }
  }
  return results;
}
