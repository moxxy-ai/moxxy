import { createHash } from 'node:crypto';
import type { AuditRecord, UnchainedAuditRecord } from '@moxxy/sdk';

/**
 * Hash chaining, which is what makes the trail tamper-EVIDENT.
 *
 * A plain append-only file proves nothing: whoever can write it can rewrite it.
 * Each record instead commits to its predecessor's hash, so removing or editing
 * any record breaks every hash after it. That does not make the file
 * tamper-PROOF (an attacker with write access can recompute the whole chain),
 * and claiming otherwise would be dishonest. It makes silent, selective
 * deletion detectable, which is the realistic threat: an operator or an agent
 * quietly dropping the one line that recorded what they did.
 *
 * Genuine tamper-proofing needs the chain head published somewhere the local
 * machine cannot rewrite, which is exactly what a remote sink provides. The
 * local floor is the fallback, and it is honest about being one.
 */

/**
 * Canonical serialization for hashing. Keys are emitted in a FIXED order rather
 * than `JSON.stringify`'s insertion order, because two records with identical
 * content but different key order must hash identically, or verification breaks
 * the moment a record round-trips through a different serializer.
 */
function canonical(record: UnchainedAuditRecord, seq: number, prevHash: string | null): string {
  return JSON.stringify([
    seq,
    record.ts,
    record.sessionId,
    record.turnId,
    record.action,
    record.eventType,
    record.actor
      ? [record.actor.issuer, record.actor.id, record.actor.kind]
      : null,
    // Detail is hashed via a stable key ordering too.
    record.detail ? stableEntries(record.detail) : null,
    prevHash,
  ]);
}

function stableEntries(obj: Readonly<Record<string, unknown>>): Array<[string, unknown]> {
  return Object.entries(obj)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, v] as [string, unknown]);
}

/** Seal a record into the chain. */
export function chainRecord(
  record: UnchainedAuditRecord,
  seq: number,
  prevHash: string | null,
): AuditRecord {
  const hash = createHash('sha256').update(canonical(record, seq, prevHash)).digest('hex');
  return { ...record, seq, prevHash, hash };
}

export type ChainVerdict =
  | { readonly ok: true; readonly count: number; readonly head: string | null }
  | {
      readonly ok: false;
      readonly count: number;
      readonly brokenAt: number;
      readonly reason: string;
    };

/**
 * Verify a chain end to end. Reports the FIRST break rather than a list: after
 * one broken link every later hash is unverifiable anyway, so enumerating them
 * would be noise that hides where the damage starts.
 */
export function verifyChain(records: ReadonlyArray<AuditRecord>): ChainVerdict {
  let prevHash: string | null = null;
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.seq !== i) {
      return {
        ok: false,
        count: records.length,
        brokenAt: i,
        reason: `expected seq ${i}, found ${record.seq} (records are missing or reordered)`,
      };
    }
    if (record.prevHash !== prevHash) {
      return {
        ok: false,
        count: records.length,
        brokenAt: i,
        reason: 'prevHash does not match the preceding record (a record was removed or altered)',
      };
    }
    const expected: string = chainRecord(record, record.seq, record.prevHash).hash;
    if (expected !== record.hash) {
      return {
        ok: false,
        count: records.length,
        brokenAt: i,
        reason: 'record hash does not match its content (the record was altered)',
      };
    }
    prevHash = record.hash;
  }
  return { ok: true, count: records.length, head: prevHash };
}
