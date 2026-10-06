import { defineTool, z } from '@moxxy/sdk';
import { backgroundJobs } from './jobs.js';

export const stopJobTool = defineTool({
  name: 'StopJob',
  icon: 'terminal',
  description:
    'Stop a background job started with Bash `background: true` — its whole process tree — and return ' +
    'the output it printed since the last Wait.',
  inputSchema: z.object({ jobId: z.string().min(1) }),
  // Only ends a process this session started through an approved Bash call.
  permission: { action: 'allow' },
  isolation: {
    required: 'inproc',
    capabilities: { net: { mode: 'none' }, timeMs: 10_000 },
  },
  async handler({ jobId }, ctx) {
    const job = backgroundJobs.find(String(ctx.sessionId), jobId);
    await backgroundJobs.stop(job);
    return job.report();
  },
});
