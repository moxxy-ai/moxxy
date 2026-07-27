import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ensurePrivateDir, ensurePrivateFile, moxxyPath } from '@moxxy/sdk/server';
import {
  defineAuditSink,
  createMutex,
  type AuditRecord,
  type AuditSinkDef,
  type AuditSinkSession,
  type Mutex,
  type UnchainedAuditRecord,
} from '@moxxy/sdk';
import { chainRecord, verifyChain, type ChainVerdict } from './chain.js';

/**
 * The protected local floor: one hash-chained JSONL per day under
 * `~/.moxxy/audit/`.
 *
 * Daily files rather than per-session, because an auditor asks "what happened
 * on the 14th", not "what happened in session 01J…". It also means the chain
 * spans every session on that day, so deleting a whole session's records still
 * breaks the chain.
 *
 * A local file can be rewritten wholesale by whoever can write it, so this is
 * tamper-EVIDENT, not tamper-proof. It is the fallback for a machine with no
 * remote sink configured, and it says so rather than overclaiming.
 */

export function auditDir(): string {
  return moxxyPath('audit');
}

/** UTC day key, so records do not reshuffle across a DST boundary or when a
 *  fleet spans time zones. */
function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function auditFileFor(ts: number): string {
  return path.join(auditDir(), `${dayKey(ts)}.jsonl`);
}

/**
 * Read one day's records. Malformed lines are SKIPPED rather than throwing, so
 * a truncated final line (the process died mid-write) still lets the rest
 * verify; the resulting seq gap is itself reported by {@link verifyChain}.
 */
export async function readAuditDay(day: string): Promise<AuditRecord[]> {
  const file = path.join(auditDir(), `${day}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: AuditRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof (parsed as AuditRecord).hash === 'string') {
        out.push(parsed as AuditRecord);
      }
    } catch {
      /* truncated or corrupt line: the seq gap surfaces during verification */
    }
  }
  return out;
}

/** Every day that has an audit file, oldest first. */
export async function listAuditDays(): Promise<string[]> {
  try {
    const names = await fs.readdir(auditDir());
    return names
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .map((n) => n.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

/** Verify one day's chain. */
export async function verifyAuditDay(day: string): Promise<ChainVerdict> {
  return verifyChain(await readAuditDay(day));
}

/**
 * Drop audit files older than `retentionDays`. Returns the days removed.
 * Retention is a policy decision the operator makes; keeping everything forever
 * is its own compliance problem.
 */
export async function pruneAuditDays(retentionDays: number, now = Date.now()): Promise<string[]> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return [];
  const cutoff = dayKey(now - retentionDays * 24 * 60 * 60 * 1000);
  const removed: string[] = [];
  for (const day of await listAuditDays()) {
    if (day >= cutoff) continue;
    try {
      await fs.rm(path.join(auditDir(), `${day}.jsonl`));
      removed.push(day);
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

/**
 * Appends are serialized per process. The chain is inherently sequential (each
 * record commits to the previous hash), so two concurrent writers computing
 * `prevHash` from the same snapshot would both claim the same predecessor and
 * fork the chain.
 */
const writeMutex: Mutex = createMutex();

/**
 * Chain state, cached per day file so a busy session does not re-read the whole
 * file per record. Rebuilt when the day rolls over.
 */
interface ChainHead {
  readonly file: string;
  seq: number;
  hash: string | null;
}

let head: ChainHead | null = null;

async function loadHead(file: string): Promise<ChainHead> {
  if (head && head.file === file) return head;
  // Resuming an existing day (a second moxxy process, or a restart) must
  // continue that chain rather than starting a new one at seq 0.
  const day = path.basename(file, '.jsonl');
  const existing = await readAuditDay(day);
  const last = existing[existing.length - 1];
  head = { file, seq: last ? last.seq + 1 : 0, hash: last ? last.hash : null };
  return head;
}

/** Test seam: forget the cached chain head. */
export function resetAuditHeadForTests(): void {
  head = null;
}

/**
 * Seal a record at the next chain position and append it, all under ONE lock
 * acquisition. Reserving the position and writing must be atomic: two writers
 * that both read `prevHash` before either appends would commit to the same
 * predecessor and fork the chain.
 */
export async function appendAuditRecord(record: UnchainedAuditRecord): Promise<boolean> {
  return await writeMutex.run(async () => {
    try {
      await ensurePrivateDir(auditDir());
      const file = auditFileFor(Date.now());
      const current = await loadHead(file);
      const sealed = chainRecord(record, current.seq, current.hash);
      await ensurePrivateFile(file);
      await fs.appendFile(file, JSON.stringify(sealed) + '\n', 'utf8');
      current.seq += 1;
      current.hash = sealed.hash;
      return true;
    } catch {
      // Never throw into the turn being audited. Drop the cached head so the
      // next attempt re-reads from disk instead of chaining onto a position
      // that may not have been written; the caller reports the degradation.
      head = null;
      return false;
    }
  });
}

/** The floor sink: local, hash-chained, owner-only. */
export const jsonlAuditSink: AuditSinkDef = defineAuditSink({
  name: 'local',
  description: 'hash-chained JSONL under ~/.moxxy/audit (tamper-evident, local only)',
  open(): AuditSinkSession {
    return {
      write: (record) => appendAuditRecord(record),
      close: async () => {},
    };
  },
});
