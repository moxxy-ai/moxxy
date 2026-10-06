import { MoxxyError, defineTool, waitFor, z } from '@moxxy/sdk';
import { backgroundJobs, type BackgroundJob } from './jobs.js';

export const MAX_WAIT_SECONDS = 600;

/**
 * The `until` condition, or undefined when there is none. Models fill optional
 * fields with placeholders (`" "`, `".*"`); a pattern that already matches
 * empty output is no condition at all and would end the wait at once.
 */
function untilCondition(until: string | undefined): RegExp | undefined {
  if (until === undefined || until.trim() === '') return undefined;
  let pattern: RegExp;
  try {
    pattern = new RegExp(until);
  } catch (e) {
    throw new MoxxyError({ code: 'TOOL_ERROR', message: `Wait: invalid \`until\` pattern: ${(e as Error).message}` });
  }
  return pattern.test('') ? undefined : pattern;
}

export const waitTool = defineTool({
  name: 'Wait',
  icon: 'terminal',
  description:
    'Block until a background job (started with Bash `background: true`) finishes — or prints output ' +
    'matching `until` — and return what it printed since the last Wait. It wakes the instant that ' +
    'happens, so prefer it over Sleep whenever you wait on a job. `timeoutSeconds` only bounds the wait: ' +
    'on timeout the job is still running and you can Wait again, do other work, or StopJob it. Without ' +
    '`jobId` it waits for whichever running job finishes first. A blank `until`, or one that matches empty ' +
    'output (like `.*`), is ignored.',
  inputSchema: z.object({
    jobId: z.string().min(1).optional().describe('The job to wait on; omit to wait for any running job.'),
    until: z
      .string()
      .min(1)
      .optional()
      .describe('Regex (JavaScript syntax) matched against output printed since the last Wait, e.g. "ready on \\\\d+".'),
    timeoutSeconds: z.number().positive().max(MAX_WAIT_SECONDS).optional().default(60),
  }),
  // Reads and waits on jobs this session already started — no side effects.
  permission: { action: 'allow' },
  isolation: {
    // The job registry lives in the host process; an isolated copy has no jobs.
    required: 'inproc',
    capabilities: { net: { mode: 'none' }, timeMs: MAX_WAIT_SECONDS * 1_000 + 1_000 },
  },
  async handler({ jobId, until, timeoutSeconds }, ctx) {
    const sessionId = String(ctx.sessionId);
    const pattern = untilCondition(until);
    // A blank id is a placeholder for "not given", i.e. any running job.
    const id = jobId?.trim();
    const jobs = id ? [backgroundJobs.find(sessionId, id)] : backgroundJobs.running(sessionId);
    if (jobs.length === 0) return 'No background jobs are running.';

    const settled = (): { job: BackgroundJob; headline?: string } | undefined => {
      for (const job of jobs) {
        if (pattern?.test(job.unread())) {
          const still = job.state === 'running' ? ' and is still running' : '';
          return { job, headline: `job ${job.id} printed ${String(pattern)}${still}` };
        }
        if (job.state !== 'running') return { job };
      }
      return undefined;
    };
    const outcome = await waitFor(settled, {
      wakeOn: jobs.map((job) => job.onChange),
      timeoutMs: timeoutSeconds * 1_000,
      signal: ctx.signal,
    });
    if (outcome.status === 'aborted') {
      throw new MoxxyError({
        code: 'ABORTED',
        message: `Wait interrupted; ${jobs.map((job) => job.id).join(', ')} keep running.`,
      });
    }
    if (outcome.status === 'timeout') return jobs.map((job) => job.report()).join('\n\n');
    return outcome.value.job.report(outcome.value.headline);
  },
});
