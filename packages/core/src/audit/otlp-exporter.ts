import type { AuditExportBatch, AuditExportContext, AuditRecord } from '@moxxy/sdk';
import { defineAuditExporter, redactSecrets } from '@moxxy/sdk';

/**
 * OTLP/HTTP logs, spoken directly over `fetch`.
 *
 * No `@opentelemetry/*` dependency on purpose. The wire format is a stable,
 * documented JSON shape and this is one POST; pulling in the SDK would add
 * megabytes to a CLI whose bundle budget is enforced in `tsup.config.ts`, to
 * gain a client we would use one function of.
 *
 * Audit records map to LOGS rather than traces. A trace answers "how did this
 * request flow"; an audit trail answers "what was done, by whom, and was it
 * allowed", which is a log with attributes. Modelling it as spans would force a
 * parent/child shape onto records that are a flat sequence.
 */
const OTLP_TIMEOUT_MS = 30_000;

type AnyValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };

const value = (v: unknown): AnyValue => {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number' && Number.isInteger(v)) return { intValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  return { stringValue: JSON.stringify(v) };
};

const attr = (key: string, v: unknown): { key: string; value: AnyValue } => ({
  key,
  value: value(v),
});

/**
 * Denials and errors are the rows a reviewer filters for, so they carry a
 * severity that a collector can route on rather than being flattened to INFO
 * with everything else.
 */
function severityOf(record: AuditRecord): { number: number; text: string } {
  if (record.action === 'error') return { number: 17, text: 'ERROR' };
  if (record.action === 'tool.denied') return { number: 13, text: 'WARN' };
  return { number: 9, text: 'INFO' };
}

function logRecord(record: AuditRecord): unknown {
  const sev = severityOf(record);
  const attrs = [
    attr('moxxy.action', record.action),
    attr('moxxy.event_type', record.eventType),
    attr('moxxy.session_id', String(record.sessionId)),
    attr('moxxy.turn_id', String(record.turnId)),
    attr('moxxy.seq', record.seq),
    // The chain hash is the record's stable identity. Export is at-least-once,
    // so a collector needs this to deduplicate a replayed batch.
    attr('moxxy.hash', record.hash),
    attr('moxxy.prev_hash', record.prevHash ?? ''),
  ];
  if (record.actor) {
    attrs.push(attr('enduser.id', record.actor.id));
    attrs.push(attr('moxxy.actor.issuer', record.actor.issuer));
    attrs.push(attr('moxxy.actor.kind', record.actor.kind));
  }
  // Redacted again on the way out. The local sink already redacts, but this is
  // the boundary where records leave the machine, and a detail added by a
  // future sink that forgot would leak here rather than at home.
  const detail = redactSecrets(record.detail ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(detail)) {
    attrs.push(attr(`moxxy.detail.${k}`, v));
  }

  return {
    timeUnixNano: String(BigInt(record.ts) * 1_000_000n),
    severityNumber: sev.number,
    severityText: sev.text,
    body: { stringValue: record.action },
    attributes: attrs,
  };
}

function payload(batch: AuditExportBatch): unknown {
  const res = batch.resource;
  const resourceAttrs = [
    attr('service.name', 'moxxy'),
    attr('service.version', res.cliVersion),
    attr('host.name', res.host),
  ];
  if (res.principal) resourceAttrs.push(attr('enduser.id', res.principal.id));

  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttrs },
        scopeLogs: [
          {
            scope: { name: 'moxxy.audit' },
            logRecords: batch.records.map(logRecord),
          },
        ],
      },
    ],
  };
}

export const otlpAuditExporter = defineAuditExporter({
  name: 'otlp',
  description: 'OTLP/HTTP logs to an OpenTelemetry collector',
  async send(batch: AuditExportBatch, ctx: AuditExportContext): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const configured = ctx.settings.headers;
    if (configured && typeof configured === 'object') {
      for (const [k, v] of Object.entries(configured as Record<string, unknown>)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
      }
    }

    const deadline = AbortSignal.timeout(OTLP_TIMEOUT_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;

    const res = await fetch(ctx.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload(batch)),
      signal,
    });

    if (!res.ok) {
      throw new Error(`collector rejected the batch: HTTP ${res.status}`);
    }

    // OTLP can accept the REQUEST and still reject records inside it. Treating
    // a 200 as success here would advance the checkpoint past records the
    // collector threw away, which is the exact silent gap this must not create.
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        const rejected = JSON.parse(text)?.partialSuccess?.rejectedLogRecords;
        if (rejected !== undefined && Number(rejected) > 0) {
          throw new Error(`collector rejected ${rejected} record(s) of ${batch.records.length}`);
        }
      } catch (err) {
        // A body we cannot parse is not evidence of rejection; only an explicit
        // rejectedLogRecords count is. Rethrow our own error, ignore JSON noise.
        if (err instanceof Error && err.message.startsWith('collector rejected')) throw err;
      }
    }
  },
});
