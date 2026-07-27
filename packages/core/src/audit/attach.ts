import type { AuditSinkDef, AuditSinkSession, MoxxyEvent } from '@moxxy/sdk';
import type { Session } from '../session.js';
import { createLogger, type Logger } from '../logger.js';
import { projectAuditRecord, type AuditProjectionOptions } from './project.js';

export interface AttachAuditOptions extends AuditProjectionOptions {
  readonly logger?: Logger;
}

export interface AuditHandle {
  /** Stop recording and flush. */
  close(): Promise<void>;
  /** True while writes are failing (the trail has a hole). */
  readonly degraded: boolean;
}

/**
 * Stream a session's auditable events into a sink.
 *
 * Deliberately a SEPARATE subscription from session persistence rather than a
 * projection of it. The trail must survive an operator disabling session
 * persistence, and it records a different, smaller thing: not the conversation,
 * but who did what and whether it was allowed.
 *
 * Writes are fire-and-forget from the turn's perspective. Blocking a tool call
 * on a slow audit sink would make the trail a liveness risk, and an agent that
 * hangs because logging is slow is worse than one whose logging is behind. The
 * queue below keeps records ORDERED despite that, which the hash chain requires.
 */
export function attachAuditSink(
  session: Session,
  sink: AuditSinkDef,
  opts: AttachAuditOptions = {},
): AuditHandle {
  const logger = opts.logger ?? createLogger();
  const sinkSession: AuditSinkSession = sink.open({ sessionId: session.id, cwd: session.cwd });

  // Serialize writes: the chain is sequential, so overlapping appends would
  // interleave positions. Also gives close() something to await.
  let queue: Promise<void> = Promise.resolve();
  let degraded = false;
  let closed = false;

  const unsubscribe = session.log.subscribe((event: MoxxyEvent) => {
    if (closed) return;
    const record = projectAuditRecord(event, opts);
    if (!record) return;
    queue = queue.then(async () => {
      try {
        const ok = await sinkSession.write(record);
        if (!ok && !degraded) {
          degraded = true;
          // Warn ONCE per streak: an audit sink that fails usually keeps
          // failing, and a warning per event would bury the turn's real output.
          logger.warn('audit sink write failed; the trail has a gap', {
            sink: sink.name,
            sessionId: session.id,
          });
        } else if (ok && degraded) {
          degraded = false;
          logger.info('audit sink recovered', { sink: sink.name });
        }
      } catch (err) {
        // A sink that throws violates its contract, but the turn must not care.
        if (!degraded) {
          degraded = true;
          logger.warn('audit sink threw; the trail has a gap', {
            sink: sink.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  });

  return {
    get degraded() {
      return degraded;
    },
    close: async () => {
      closed = true;
      unsubscribe();
      await queue;
      await sinkSession.close();
    },
  };
}
