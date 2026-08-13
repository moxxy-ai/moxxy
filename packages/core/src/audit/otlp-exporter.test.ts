import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditExportBatch, AuditRecord } from '@moxxy/sdk';
import { otlpAuditExporter } from './otlp-exporter.js';

const record = (over: Partial<AuditRecord> = {}): AuditRecord =>
  ({
    ts: 1_700_000_000_000,
    sessionId: 's1',
    turnId: 't1',
    action: 'tool.request',
    eventType: 'tool_call_requested',
    seq: 0,
    prevHash: null,
    hash: 'abc123',
    ...over,
  }) as AuditRecord;

const batch = (records: AuditRecord[]): AuditExportBatch => ({
  records,
  resource: { host: 'workstation-7', cliVersion: '1.2.3' },
});

const ctx = { endpoint: 'https://collector/v1/logs', settings: {} };

const stubFetch = (res: Partial<Response> & { body?: string }) => {
  const fn = vi.fn(async () => ({
    ok: res.ok ?? true,
    status: res.status ?? 200,
    text: async () => res.body ?? '',
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe('otlpAuditExporter', () => {
  it('posts OTLP log records carrying the chain hash as a dedup key', async () => {
    const fetchFn = stubFetch({ ok: true });

    await otlpAuditExporter.send(batch([record()]), ctx);

    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    const log = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    const attrs = Object.fromEntries(
      log.attributes.map((a: { key: string; value: Record<string, unknown> }) => [
        a.key,
        Object.values(a.value)[0],
      ]),
    );

    expect(attrs['moxxy.hash']).toBe('abc123');
    expect(attrs['moxxy.action']).toBe('tool.request');
    expect(log.timeUnixNano).toBe('1700000000000000000');
  });

  it('identifies the host in resource attributes', async () => {
    const fetchFn = stubFetch({ ok: true });

    await otlpAuditExporter.send(batch([record()]), ctx);

    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    const attrs = Object.fromEntries(
      body.resourceLogs[0].resource.attributes.map(
        (a: { key: string; value: Record<string, unknown> }) => [a.key, Object.values(a.value)[0]],
      ),
    );

    expect(attrs['host.name']).toBe('workstation-7');
    expect(attrs['service.name']).toBe('moxxy');
    expect(attrs['service.version']).toBe('1.2.3');
  });

  it('raises the severity of a denial so a collector can route on it', async () => {
    const fetchFn = stubFetch({ ok: true });

    await otlpAuditExporter.send(
      batch([record({ action: 'tool.denied', eventType: 'tool_call_denied' })]),
      ctx,
    );

    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords[0].severityText).toBe('WARN');
  });

  it('throws on an HTTP error so the checkpoint does not advance', async () => {
    stubFetch({ ok: false, status: 503 });

    await expect(otlpAuditExporter.send(batch([record()]), ctx)).rejects.toThrow('503');
  });

  it('throws when a 200 response reports rejected records', async () => {
    // The subtle one: OTLP can accept the REQUEST and still discard records
    // inside it. Treating that as success would checkpoint past data the
    // collector threw away.
    stubFetch({ ok: true, body: JSON.stringify({ partialSuccess: { rejectedLogRecords: 3 } }) });

    await expect(otlpAuditExporter.send(batch([record()]), ctx)).rejects.toThrow('rejected 3');
  });

  it('accepts a 200 that reports zero rejections', async () => {
    stubFetch({ ok: true, body: JSON.stringify({ partialSuccess: { rejectedLogRecords: 0 } }) });

    await expect(otlpAuditExporter.send(batch([record()]), ctx)).resolves.toBeUndefined();
  });

  it('does not treat an unparseable body as a rejection', async () => {
    stubFetch({ ok: true, body: 'OK' });

    await expect(otlpAuditExporter.send(batch([record()]), ctx)).resolves.toBeUndefined();
  });

  it('sends configured headers, so an authenticated collector is reachable', async () => {
    const fetchFn = stubFetch({ ok: true });

    await otlpAuditExporter.send(batch([record()]), {
      ...ctx,
      settings: { headers: { Authorization: 'Bearer t0ken' } },
    });

    const init = fetchFn.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe('Bearer t0ken');
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('redacts a secret that reached the trail, at the boundary it leaves the machine', async () => {
    const fetchFn = stubFetch({ ok: true });

    await otlpAuditExporter.send(
      batch([record({ detail: { api_key: 'sk-ant-secret-value', tool: 'Read' } })]),
      ctx,
    );

    const raw = fetchFn.mock.calls[0]![1]!.body as string;
    expect(raw).not.toContain('sk-ant-secret-value');
    expect(raw).toContain('Read');
  });
});
