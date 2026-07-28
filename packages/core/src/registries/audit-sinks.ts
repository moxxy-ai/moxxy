import type { AuditSinkDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * The single-active AuditSink registry. Core seeds the hash-chained local sink
 * as a protected floor; uses throw-on-duplicate `register` (NOT override) so a
 * discovered plugin's sink is added but never silently shadows the floor. The
 * operator must `setActive` it by name.
 *
 * That opt-in IS the trust boundary, and more so here than for other blocks: an
 * audit sink sees every recorded action and, unlike the event store, its whole
 * purpose is to send them somewhere else. Silently adopting a discovered sink
 * would be a data-exfiltration path wearing a compliance hat.
 */
export class AuditSinkRegistry extends ActiveDefRegistry<AuditSinkDef> {
  constructor() {
    super({ noun: 'AuditSink' });
  }
}
