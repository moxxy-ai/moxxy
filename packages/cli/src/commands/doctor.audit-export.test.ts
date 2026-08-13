import { describe, it, expect, vi } from 'vitest';
import type { MoxxyConfig } from '@moxxy/config';
import { buildAuditExportDoctorCheck } from './doctor.js';

const cfg = (over: Partial<MoxxyConfig> = {}): MoxxyConfig => over as MoxxyConfig;

const withExport = (audit: Record<string, unknown> = {}) =>
  cfg({
    audit: {
      enabled: true,
      export: { exporter: 'otlp', endpoint: 'https://collector/v1/logs' },
      ...audit,
    },
  } as Partial<MoxxyConfig>);

describe('buildAuditExportDoctorCheck', () => {
  it('says nothing at all when no export is configured', async () => {
    expect(await buildAuditExportDoctorCheck(cfg(), async () => 0)).toBeNull();
  });

  it('passes when the trail is fully drained', async () => {
    const check = await buildAuditExportDoctorCheck(withExport(), async () => 0);

    expect(check?.status).toBe('ok');
  });

  it('warns on a backlog, which is how a stopped job becomes visible', async () => {
    // The failure mode: the scheduled export dies, the local trail keeps being
    // written, and nothing looks wrong until someone asks for the records.
    const check = await buildAuditExportDoctorCheck(withExport(), async () => 412);

    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('412');
  });

  it('warns when an export is configured but nothing is being recorded', async () => {
    const check = await buildAuditExportDoctorCheck(
      cfg({
        audit: { enabled: false, export: { exporter: 'otlp', endpoint: 'https://c' } },
      } as Partial<MoxxyConfig>),
      async () => 0,
    );

    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('audit.enabled is false');
  });

  it('reports an unreadable checkpoint instead of throwing out of doctor', async () => {
    const check = await buildAuditExportDoctorCheck(withExport(), async () => {
      throw new Error('EACCES');
    });

    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('EACCES');
  });

  it('asks about the configured exporter and endpoint, not a default', async () => {
    const countPending = vi.fn(async () => 0);

    await buildAuditExportDoctorCheck(
      cfg({
        audit: {
          enabled: true,
          export: { exporter: 'splunk', endpoint: 'https://splunk.internal/x' },
        },
      } as Partial<MoxxyConfig>),
      countPending,
    );

    expect(countPending).toHaveBeenCalledWith('splunk', 'https://splunk.internal/x');
  });
});
