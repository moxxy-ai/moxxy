import {
  attachAuditSink,
  jsonlAuditSink,
  pruneAuditDays,
  type AuditHandle,
  type Session,
} from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';

/**
 * Wire the audit trail for a session, when the operator asked for one.
 *
 * Off unless `audit.enabled` is set. An audit trail is a deliberate choice: it
 * is another file holding sensitive material, and one nobody asked for is a
 * liability rather than a control.
 *
 * Returns null when auditing is off, so callers can skip teardown entirely.
 */
export function attachAudit(session: Session, config: MoxxyConfig): AuditHandle | null {
  const audit = config.audit;
  if (!audit?.enabled) return null;

  const name = audit.sink ?? jsonlAuditSink.name;
  // Resolve through the session's registry so a plugin-provided sink (syslog,
  // OTel, S3) is selectable by name exactly like every other block. Falling
  // back to the floor rather than throwing keeps a typo from silently leaving
  // an enabled trail unrecorded, and the floor is always present.
  const sink = session.auditSinks.list().find((s) => s.name === name) ?? jsonlAuditSink;
  if (sink.name !== name) {
    session.logger.warn('audit sink not registered; using the local floor', {
      requested: name,
      using: sink.name,
    });
  }

  const handle = attachAuditSink(session, sink, {
    logger: session.logger,
    ...(audit.includePromptText ? { includePromptText: true } : {}),
  });

  // Retention runs detached: pruning month-old files must not delay boot, and
  // failing to prune is not a reason to refuse to audit.
  if (audit.retentionDays !== undefined) {
    void pruneAuditDays(audit.retentionDays).catch(() => {});
  }

  return handle;
}
