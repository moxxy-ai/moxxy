import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type {
  PendingToolCall,
  PermissionDecision,
  WorkflowApprovalScope,
  WorkflowApprovalChoice,
  WorkflowApprovalItem,
} from '@moxxy/sdk';

const idSchema = z.string().uuid();
const choiceSchema = z.enum(['allow_once', 'allow_always', 'deny']);
const requestSchema = z
  .object({
    id: idSchema,
    workflowId: z.string().min(1),
    workflowName: z.string().min(1),
    revision: z.string().min(1),
    runId: z.string().min(1),
    tool: z.string().min(1),
    input: z.unknown(),
    fingerprint: z.string().length(64),
    createdAt: z.number().positive(),
    pid: z.number().int().positive(),
  })
  .strict();
const decisionSchema = z
  .object({ choice: choiceSchema, createdAt: z.number().positive() })
  .strict();
const markerSchema = z.object({ createdAt: z.number().positive() }).strict();
type Request = z.infer<typeof requestSchema>;

/** Stable cryptographic identity; property ordering cannot broaden a grant. */
export function approvalFingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return v;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function runKey(scope: Pick<WorkflowApprovalScope, 'workflowId' | 'runId'>): string {
  const hash = approvalFingerprint([scope.workflowId, scope.runId]);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(
    17,
    20,
  )}-${hash.slice(20, 32)}`;
}

/** Immutable records + exclusive publication avoid cross-process RMW races. */
export class WorkflowApprovals {
  private readonly calls = new Map<string, Promise<PermissionDecision>>();
  private readonly receipts = new Map<string, string>();
  constructor(private readonly dir: string) {}

  private file(kind: string, id: string): string {
    return join(this.dir, kind, idSchema.parse(id) + '.json');
  }

  private async read<T>(kind: string, id: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const raw = await readFile(this.file(kind, id), 'utf8');
      if (Buffer.byteLength(raw) > 1_048_576) throw new Error('Approval record exceeds size limit');
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error; // Corrupt approval evidence is never treated as empty state.
    }
  }

  private async publish(kind: string, id: string, value: unknown): Promise<void> {
    const folder = join(this.dir, kind);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const target = this.file(kind, id);
    const temporary = join(folder, '.' + randomUUID() + '.tmp');
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 1_048_576) throw new Error('Approval record exceeds size limit');
    try {
      await writeFile(temporary, json, { mode: 0o600, flag: 'wx' });
      // Link is an atomic, non-replacing publish on NTFS and POSIX. A second
      // client cannot change a decision, even across runner processes.
      await link(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private async requests(): Promise<Request[]> {
    let names: string[];
    try {
      names = await readdir(join(this.dir, 'requests'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const result: Request[] = [];
    for (const name of names.filter((name) => name.endsWith('.json'))) {
      const request = await this.read('requests', name.slice(0, -5), requestSchema);
      if (request) result.push(request);
    }
    return result;
  }

  async list(): Promise<WorkflowApprovalItem[]> {
    return Promise.all(
      (await this.requests()).map(async (request) => {
        const decision = await this.read('decisions', request.id, decisionSchema);
        const revoked = await this.read('revoked', request.id, markerSchema);
        const cancelled =
          (await this.read('cancelled', request.id, markerSchema)) ||
          (await this.isCancelled(request));
        const status = revoked
          ? 'revoked'
          : cancelled
          ? 'cancelled'
          : decision
          ? decision.choice === 'deny'
            ? 'denied'
            : 'allowed'
          : alive(request.pid)
          ? 'pending'
          : 'interrupted';
        const { pid: _pid, fingerprint: _fingerprint, ...item } = request;
        return {
          ...item,
          input: request.input,
          status,
          ...(decision ? { choice: decision.choice } : {}),
        };
      }),
    );
  }

  async decide(id: string, choice: WorkflowApprovalChoice): Promise<void> {
    choiceSchema.parse(choice);
    const item = (await this.list()).find((item) => item.id === idSchema.parse(id));
    if (!item || item.status !== 'pending') throw new Error('Approval is no longer pending');
    await this.publish('decisions', id, { choice, createdAt: Date.now() });
  }

  async revoke(id: string): Promise<void> {
    const decision = await this.read('decisions', id, decisionSchema);
    if (decision?.choice !== 'allow_always') throw new Error('No persistent approval to revoke');
    await this.publish('revoked', id, { createdAt: Date.now() });
  }

  async cancel(id: string): Promise<void> {
    const request = await this.read('requests', id, requestSchema);
    if (!request) throw new Error('Unknown approval');
    if (!(await this.isCancelled(request))) {
      try {
        await this.publish('stopped-runs', runKey(request), { createdAt: Date.now() });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  }

  async isCancelled(scope: Pick<WorkflowApprovalScope, 'workflowId' | 'runId'>): Promise<boolean> {
    return !!(await this.read('stopped-runs', runKey(scope), markerSchema));
  }

  async finishRun(runId: string): Promise<void> {
    for (const key of this.calls.keys())
      if (key.startsWith(runId + ':')) {
        this.calls.delete(key);
        this.receipts.delete(key);
      }
    for (const request of await this.requests()) {
      if (
        request.runId !== runId ||
        (await this.read('decisions', request.id, decisionSchema)) ||
        (await this.read('cancelled', request.id, markerSchema))
      )
        continue;
      await this.publish('cancelled', request.id, { createdAt: Date.now() });
    }
  }

  async check(
    scope: WorkflowApprovalScope,
    call: PendingToolCall,
    signal: AbortSignal,
    valid: () => Promise<boolean> = async () => true,
  ): Promise<PermissionDecision> {
    const key = scope.runId + ':' + approvalFingerprint([scope, call]);
    let pending = this.calls.get(key);
    if (!pending) {
      pending = this.resolve(scope, call, signal, valid, key);
      this.calls.set(key, pending);
    }
    const decision = await pending;
    const receipt = this.receipts.get(key);
    if (
      signal.aborted ||
      (await this.isCancelled(scope)) ||
      !(await valid()) ||
      (receipt && (await this.read('revoked', receipt, markerSchema)))
    ) {
      return { mode: 'deny', reason: 'Workflow approval revoked, changed or cancelled' };
    }
    return decision;
  }

  private async resolve(
    scope: WorkflowApprovalScope,
    call: PendingToolCall,
    signal: AbortSignal,
    valid: () => Promise<boolean>,
    key: string,
  ): Promise<PermissionDecision> {
    const deny = { mode: 'deny' as const, reason: 'Workflow action denied or cancelled' };
    if (signal.aborted || (await this.isCancelled(scope)) || !(await valid())) return deny;
    const fingerprint = approvalFingerprint({ name: call.name, input: call.input });
    for (const old of await this.requests()) {
      if (
        old.workflowId !== scope.workflowId ||
        old.revision !== scope.revision ||
        old.fingerprint !== fingerprint
      )
        continue;
      const decision = await this.read('decisions', old.id, decisionSchema);
      if (decision?.choice === 'deny' && old.runId === scope.runId) return deny;
      if (
        decision?.choice === 'allow_always' &&
        (await this.read('consumed', old.id, markerSchema)) &&
        !(await this.read('revoked', old.id, markerSchema)) &&
        !(await this.read('cancelled', old.id, markerSchema))
      ) {
        this.receipts.set(key, old.id);
        return { mode: 'allow' };
      }
    }
    const request = requestSchema.parse({
      ...scope,
      id: randomUUID(),
      tool: call.name,
      input: call.input,
      fingerprint,
      createdAt: Date.now(),
      pid: process.pid,
    });
    await this.publish('requests', request.id, request);
    this.receipts.set(key, request.id);
    try {
      while (!signal.aborted && !(await this.isCancelled(scope)) && (await valid())) {
        const decision = await this.read('decisions', request.id, decisionSchema);
        if (decision) {
          if (signal.aborted || (await this.isCancelled(scope)) || !(await valid())) break;
          // An abandoned request answered after a crash cannot mint a grant
          // for future runs: only the live executor acknowledges the choice.
          await this.publish('consumed', request.id, { createdAt: Date.now() });
          return decision.choice === 'deny' ? deny : { mode: 'allow' };
        }
        await delay(100, undefined, { signal });
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    await this.publish('cancelled', request.id, { createdAt: Date.now() });
    return deny;
  }
}
