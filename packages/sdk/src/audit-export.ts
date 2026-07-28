import type { AuditRecord } from './audit.js';
import type { Principal } from './principal.js';

/**
 * Shipping the local audit trail somewhere central.
 *
 * Separate from `AuditSinkDef` on purpose. A sink is the WRITE path: it is
 * handed each record as it happens. An exporter is a READER of the trail that
 * has already been durably written, driven by a checkpoint.
 *
 * That split is what makes shipping survivable. A network sink has to decide,
 * while a turn is running, what to do when the collector is down: block the
 * turn, drop the record, or buffer it in memory and lose it on exit. An
 * exporter has no such dilemma, because the record is already on disk in a
 * hash-chained file. A failed export is retried from the checkpoint, and the
 * worst case is that central visibility lags, never that the record is gone.
 */
export interface AuditExportResource {
  /** Which machine. The whole point of central collection is telling them apart. */
  readonly host: string;
  readonly cliVersion: string;
  /** Whoever the surface could establish was acting; absent on an unattributed host. */
  readonly principal?: Principal;
}

export interface AuditExportBatch {
  readonly records: ReadonlyArray<AuditRecord>;
  readonly resource: AuditExportResource;
}

export interface AuditExportContext {
  /** Destination, as configured. Exporter-defined; an endpoint URL for OTLP. */
  readonly endpoint: string;
  /** Exporter-specific settings from `audit.export`, already placeholder-resolved. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface AuditExporterDef {
  readonly name: string;
  readonly description?: string;
  /**
   * Ship one batch.
   *
   * THE CONTRACT: resolving means the destination has DURABLY accepted these
   * records, because the checkpoint advances on resolve and those records are
   * never offered again. An exporter that resolves on "request sent" turns a
   * collector-side rejection into silent data loss. When in doubt, throw:
   * re-sending a batch is cheap and records carry a hash the collector can
   * deduplicate on, whereas a skipped batch is unrecoverable.
   */
  send(batch: AuditExportBatch, ctx: AuditExportContext): Promise<void>;
}

export function defineAuditExporter(def: AuditExporterDef): AuditExporterDef {
  return def;
}
