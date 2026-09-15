import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { writeFileAtomic } from '@moxxy/sdk/server';

const ticketSchema = z
  .object({
    id: z.string().uuid(),
    pid: z.number().int().positive(),
    ticket: z.number().int().nonnegative().safe(),
  })
  .strict();
type Ticket = z.infer<typeof ticketSchema>;

/** Per-workflow bakery tickets: each process writes/removes only its own UUID.
 * No TTL may steal a live execution's lease during a long approval wait. */
export async function claimWorkflowLease(
  dir: string,
  workflowId: string,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  const folder = join(dir, createHash('sha256').update(workflowId).digest('hex'));
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const own: Ticket = { id: randomUUID(), pid: process.pid, ticket: 0 };
  const file = join(folder, own.id + '.json');
  const release = async () => {
    await unlink(file).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  };
  async function participants(): Promise<Ticket[]> {
    const all: Ticket[] = [];
    for (const name of await readdir(folder)) {
      if (!name.endsWith('.json')) continue;
      z.string().uuid().parse(name.slice(0, -5));
      try {
        const raw = await readFile(join(folder, name), 'utf8');
        if (raw.length > 2048) throw new Error('Invalid workflow lease');
        const ticket = ticketSchema.parse(JSON.parse(raw));
        if (ticket.id + '.json' !== name) throw new Error('Workflow lease identity mismatch');
        try {
          process.kill(ticket.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue;
        }
        all.push(ticket);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return all;
  }
  try {
    signal.throwIfAborted();
    await writeFileAtomic(file, JSON.stringify(own), { mode: 0o600 });
    own.ticket = Math.max(0, ...(await participants()).map((item) => item.ticket)) + 1;
    ticketSchema.parse(own);
    await writeFileAtomic(file, JSON.stringify(own), { mode: 0o600 });
    const deadline = Date.now() + 3000;
    for (;;) {
      signal.throwIfAborted();
      const others = (await participants()).filter((item) => item.id !== own.id);
      if (others.some((item) => item.ticket === 0)) {
        if (Date.now() >= deadline)
          throw new Error('Workflow execution skipped: another runner is acquiring control');
        await delay(10, undefined, { signal });
        continue;
      }
      if (
        others.some(
          (item) => item.ticket < own.ticket || (item.ticket === own.ticket && item.id < own.id),
        )
      ) {
        throw new Error(
          'Workflow execution skipped: another execution is running or awaiting approval',
        );
      }
      return release;
    }
  } catch (error) {
    await release();
    throw error;
  }
}
