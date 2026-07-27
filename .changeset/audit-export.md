---
'@moxxy/cli': minor
'@moxxy/core': minor
'@moxxy/sdk': minor
'@moxxy/config': minor
---

Ship the audit trail to a central collector: `moxxy security audit-export`, plus a built-in OTLP exporter.

The local trail answered "what happened on this machine". A fleet needs one place to ask, and a chain head the workstation cannot rewrite. Configure `audit.export.endpoint` and run the command from cron; it exits 1 when it could not drain, so a collector unreachable for a week is visible rather than silently logging "sent 0".

An exporter is a READER of the already-written trail, driven by a checkpoint, not a second write path. That is what makes shipping survivable: a network sink has to decide mid-turn whether to block, drop, or buffer when the collector is down, while an exporter just retries from the checkpoint. The local hash-chained file stays the system of record, and configuring an export does not weaken it.

The checkpoint advances only after a batch is durably accepted, so a crash or failure re-sends rather than skips, and each record carries its chain hash to deduplicate on. A 200 carrying `partialSuccess.rejectedLogRecords` counts as a failure: checkpointing past records the collector discarded is the invisible gap this exists to prevent.

Records map to OTLP logs rather than traces, spoken over plain `fetch` with no `@opentelemetry/*` dependency, which would have added megabytes to a CLI whose bundle budget is enforced at build time. `auditExporter` is a new registry kind, so another destination is a plugin; like audit sinks, a discovered exporter never activates on its own.

Exporting needs no model provider and boots no session, so a machine with an expired API key still exports.
