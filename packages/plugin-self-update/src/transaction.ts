import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Transactional bookkeeping for self-update. Every change to a user-scope
 * artifact (a plugin directory or a skill file) is bracketed by a transaction:
 * the target is snapshotted before edits, a persisted journal tracks state and
 * failed attempts, and a rollback restores the snapshot (or deletes a freshly
 * created artifact). This module is filesystem-only and imports no moxxy core,
 * so it is trivially unit-testable against a temp directory.
 */

export type TargetKind = 'plugin' | 'skill';

export type TxnState = 'open' | 'verified' | 'committed' | 'rolled_back' | 'escalated';

export interface TxnTarget {
  readonly kind: TargetKind;
  readonly name: string;
  /** Absolute path to the artifact (a directory for plugins, a file for skills). */
  readonly path: string;
}

export interface TxnAttempt {
  readonly at: string;
  readonly stage: string;
  readonly ok: boolean;
  readonly message: string;
}

/** Registered contribution names per kind — used to diff what a change added. */
export type RegistrySnapshot = Record<string, ReadonlyArray<string>>;

export interface Journal {
  readonly txnId: string;
  readonly createdAt: string;
  updatedAt: string;
  readonly target: TxnTarget;
  /** Whether the artifact existed before this transaction. false ⇒ rollback deletes it. */
  readonly existedBefore: boolean;
  state: TxnState;
  attempts: TxnAttempt[];
  /** Registry contributions captured at begin time, for an added-since diff. */
  registryBefore?: RegistrySnapshot;
}

/** Names present in `after` but not in `before`, per kind. Empty keys dropped. */
export function diffSnapshot(before: RegistrySnapshot, after: RegistrySnapshot): RegistrySnapshot {
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const key of Object.keys(after)) {
    const had = new Set(before[key] ?? []);
    const added = (after[key] ?? []).filter((n) => !had.has(n));
    if (added.length > 0) out[key] = added;
  }
  return out;
}

/** Max failed verify cycles for one transaction before we force escalation. */
export const MAX_FAILED_ATTEMPTS = 2;

const NAME_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function selfUpdateRoot(moxxyDir: string): string {
  return path.join(moxxyDir, 'self-update', 'txns');
}

export function txnDir(moxxyDir: string, txnId: string): string {
  return path.join(selfUpdateRoot(moxxyDir), txnId);
}

/**
 * Resolve the on-disk target for a (kind, name). Throws on unsafe names so a
 * model-supplied name can never escape the user artifact directories.
 */
export function resolveTarget(moxxyDir: string, kind: TargetKind, name: string): TxnTarget {
  if (!NAME_SEGMENT_RE.test(name)) {
    throw new Error(
      `invalid ${kind} name "${name}": only letters, digits, dot, dash and underscore are allowed`,
    );
  }
  const p =
    kind === 'plugin'
      ? path.join(moxxyDir, 'plugins', name)
      : path.join(moxxyDir, 'skills', `${name}.md`);
  return { kind, name, path: p };
}

export function newTxnId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a transaction: snapshot the current target (if any) into the txn dir
 * and write the initial journal. Safe to call for a not-yet-existing target.
 */
export async function beginTransaction(opts: {
  readonly moxxyDir: string;
  readonly kind: TargetKind;
  readonly name: string;
  readonly now?: Date;
}): Promise<Journal> {
  const now = opts.now ?? new Date();
  const target = resolveTarget(opts.moxxyDir, opts.kind, opts.name);
  const txnId = newTxnId(now);
  const dir = txnDir(opts.moxxyDir, txnId);
  await fs.mkdir(dir, { recursive: true });

  const existedBefore = await pathExists(target.path);
  if (existedBefore) {
    const before = path.join(dir, 'before');
    await fs.cp(target.path, before, { recursive: true });
  }

  const journal: Journal = {
    txnId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    target,
    existedBefore,
    state: 'open',
    attempts: [],
  };
  await writeJournal(opts.moxxyDir, journal);
  return journal;
}

export async function writeJournal(moxxyDir: string, journal: Journal): Promise<void> {
  journal.updatedAt = new Date().toISOString();
  const dir = txnDir(moxxyDir, journal.txnId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'journal.json');
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(journal, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

export async function readJournal(moxxyDir: string, txnId: string): Promise<Journal> {
  const file = path.join(txnDir(moxxyDir, txnId), 'journal.json');
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as Journal;
}

export async function listTransactions(moxxyDir: string): Promise<ReadonlyArray<Journal>> {
  const root = selfUpdateRoot(moxxyDir);
  let ids: string[];
  try {
    ids = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: Journal[] = [];
  for (const id of ids) {
    try {
      out.push(await readJournal(moxxyDir, id));
    } catch {
      // ignore half-written / corrupt txn dirs
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function recordAttempt(journal: Journal, attempt: Omit<TxnAttempt, 'at'>): void {
  journal.attempts.push({ at: new Date().toISOString(), ...attempt });
}

export function failedAttemptCount(journal: Journal): number {
  return journal.attempts.filter((a) => !a.ok).length;
}

/**
 * Restore the target to its pre-transaction state: copy the snapshot back, or
 * delete the artifact if it was newly created. Idempotent.
 */
export async function restoreSnapshot(moxxyDir: string, journal: Journal): Promise<void> {
  const { target, existedBefore } = journal;
  await fs.rm(target.path, { recursive: true, force: true });
  if (existedBefore) {
    const before = path.join(txnDir(moxxyDir, journal.txnId), 'before');
    await fs.cp(before, target.path, { recursive: true });
  }
}

/** Keep the most recent `keep` terminal transactions; delete older ones. */
export async function gcTransactions(moxxyDir: string, keep: number): Promise<void> {
  const all = await listTransactions(moxxyDir);
  const terminal = all.filter(
    (j) => j.state === 'committed' || j.state === 'rolled_back' || j.state === 'escalated',
  );
  for (const j of terminal.slice(keep)) {
    await fs.rm(txnDir(moxxyDir, j.txnId), { recursive: true, force: true });
  }
}
