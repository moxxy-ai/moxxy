import type { AuditExporterDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * The single-active AuditExporter registry.
 *
 * Same trust posture as {@link AuditSinkRegistry}, and for the same reason: an
 * exporter's entire purpose is to send recorded actions off the machine, so a
 * discovered one activating itself would be an exfiltration path wearing a
 * compliance hat. Throw-on-duplicate, no auto-activation; the operator names
 * one in `audit.export.exporter`.
 *
 * Unlike the sink registry there is no protected floor, because the floor for
 * exporting is "do not export".
 */
export class AuditExporterRegistry extends ActiveDefRegistry<AuditExporterDef> {
  constructor() {
    super({ noun: 'AuditExporter' });
  }
}
