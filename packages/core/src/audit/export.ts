import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type {
  AuditExportBatch,
  AuditExportResource,
  AuditExporterDef,
  AuditRecord,
} from '@moxxy/sdk';
import { auditDir, listAuditDays, readAuditDay } from './jsonl-audit-sink.js';

/**
 * How far this destination has been caught up to.
 *
 * Per destination, not per machine: two collectors are allowed to be at
 * different points, and one being down must not stall the other.
 */
export interface ExportCheckpoint {
  /** Last fully or partially exported day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Highest `seq` within that day known to be durably accepted. */
  readonly seq: number;
}

export interface ExportResult {
  readonly sent: number;
  readonly batches: number;
  readonly checkpoint: ExportCheckpoint | null;
  /** Set when the run stopped early. The checkpoint still reflects what landed. */
  readonly stoppedBecause?: string;
}

export interface ExportOptions {
  readonly endpoint: string;
  readonly resource: AuditExportResource;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly batchSize?: number;
  readonly checkpointDir?: string;
  readonly signal?: AbortSignal;
}

const DEFAULT_BATCH = 200;

const checkpointPath = (dir: string, exporter: string, endpoint: string): string =>
  path.join(
    dir,
    `.export-${exporter}-${createHash('sha256').update(endpoint).digest('hex').slice(0, 16)}.json`,
  );

export async function readCheckpoint(
  exporter: string,
  endpoint: string,
  dir = auditDir(),
): Promise<ExportCheckpoint | null> {
  try {
    const raw = JSON.parse(await fs.readFile(checkpointPath(dir, exporter, endpoint), 'utf8'));
    if (typeof raw?.day !== 'string' || typeof raw?.seq !== 'number') return null;
    return { day: raw.day, seq: raw.seq };
  } catch {
    return null;
  }
}

async function writeCheckpoint(
  exporter: string,
  endpoint: string,
  dir: string,
  cp: ExportCheckpoint,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => undefined);
  await fs.writeFile(checkpointPath(dir, exporter, endpoint), JSON.stringify(cp), { mode: 0o600 });
}

/**
 * Ship everything recorded since the last checkpoint.
 *
 * Ordering is the whole design. The checkpoint is written only AFTER `send`
 * resolves, so a crash or a failed export re-offers the batch rather than
 * skipping it. Duplicates are possible and deliberate: every record carries a
 * chain hash a collector can deduplicate on, so at-least-once with a stable id
 * is the right trade against at-most-once with silent gaps.
 *
 * Stops at the first failing batch instead of skipping ahead. Continuing past a
 * failure would advance the checkpoint over records that never landed, which is
 * exactly the invisible hole this exists to avoid.
 */
export async function exportAuditTrail(
  exporter: AuditExporterDef,
  opts: ExportOptions,
): Promise<ExportResult> {
  const dir = opts.checkpointDir ?? auditDir();
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const start = await readCheckpoint(exporter.name, opts.endpoint, dir);

  const days = (await listAuditDays()).filter((d) => !start || d >= start.day).sort();
  let checkpoint = start;
  let sent = 0;
  let batches = 0;

  for (const day of days) {
    const all = await readAuditDay(day);
    // Only the checkpoint's own day is partially consumed. A later day starts
    // whole, and re-reading the boundary day is what makes a same-day restart
    // resume rather than replay.
    const pending =
      start && day === start.day ? all.filter((r) => r.seq > start.seq) : all;

    for (let i = 0; i < pending.length; i += batchSize) {
      if (opts.signal?.aborted) {
        return { sent, batches, checkpoint, stoppedBecause: 'aborted' };
      }
      const slice = pending.slice(i, i + batchSize);
      const batch: AuditExportBatch = { records: slice, resource: opts.resource };
      try {
        await exporter.send(batch, {
          endpoint: opts.endpoint,
          settings: opts.settings ?? {},
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
      } catch (err) {
        return {
          sent,
          batches,
          checkpoint,
          stoppedBecause: err instanceof Error ? err.message : String(err),
        };
      }
      const last = slice[slice.length - 1]!;
      checkpoint = { day, seq: last.seq };
      await writeCheckpoint(exporter.name, opts.endpoint, dir, checkpoint);
      sent += slice.length;
      batches += 1;
    }
  }

  return { sent, batches, checkpoint };
}

/**
 * Records a run would ship right now, without shipping them. For `--dry-run`
 * and for the doctor row.
 *
 * `excludeSessionId` exists for the diagnostic case: booting a session to ask
 * the question writes a record of its own, so a check that counted it could
 * never report "up to date", and a check that always warns teaches people to
 * ignore it.
 */
export async function pendingExportCount(
  exporter: string,
  endpoint: string,
  dir = auditDir(),
  excludeSessionId?: string,
): Promise<number> {
  const start = await readCheckpoint(exporter, endpoint, dir);
  const days = (await listAuditDays()).filter((d) => !start || d >= start.day);
  let n = 0;
  for (const day of days) {
    const all: AuditRecord[] = await readAuditDay(day);
    const afterCheckpoint =
      start && day === start.day ? all.filter((r) => r.seq > start.seq) : all;
    n += excludeSessionId
      ? afterCheckpoint.filter((r) => String(r.sessionId) !== excludeSessionId).length
      : afterCheckpoint.length;
  }
  return n;
}
