import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditExportBatch, AuditExporterDef, AuditExportResource } from '@moxxy/sdk';
import { appendAuditRecord, resetAuditHeadForTests } from './jsonl-audit-sink.js';
import { exportAuditTrail, pendingExportCount, readCheckpoint } from './export.js';

const resource: AuditExportResource = { host: 'h1', cliVersion: '0.0.0' };

/** Collects what it was given; fails the Nth batch when told to. */
const recorder = (failOnBatch?: number): AuditExporterDef & { seen: AuditExportBatch[] } => {
  const seen: AuditExportBatch[] = [];
  return {
    name: 'rec',
    seen,
    async send(batch) {
      seen.push(batch);
      if (failOnBatch !== undefined && seen.length === failOnBatch) {
        throw new Error('collector down');
      }
    },
  } as AuditExporterDef & { seen: AuditExportBatch[] };
};

describe('exportAuditTrail', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-export-'));
    prevHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    resetAuditHeadForTests();
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    resetAuditHeadForTests();
    await fs.rm(home, { recursive: true, force: true });
  });

  const seed = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await appendAuditRecord({
        ts: 1_700_000_000_000,
        sessionId: 's1' as never,
        turnId: 't1' as never,
        action: 'tool.request',
        eventType: 'tool_call_requested',
        detail: { tool: `T${i}` },
      });
    }
  };

  it('sends everything on a first run and checkpoints at the end', async () => {
    await seed(5);
    const exp = recorder();

    const result = await exportAuditTrail(exp, { endpoint: 'http://c', resource });

    expect(result.sent).toBe(5);
    expect(result.stoppedBecause).toBeUndefined();
    expect(await readCheckpoint('rec', 'http://c')).toMatchObject({ seq: 4 });
  });

  it('sends nothing the second time, having already caught up', async () => {
    await seed(3);
    await exportAuditTrail(recorder(), { endpoint: 'http://c', resource });

    const again = recorder();
    const result = await exportAuditTrail(again, { endpoint: 'http://c', resource });

    expect(result.sent).toBe(0);
    expect(again.seen).toEqual([]);
  });

  it('resumes at the checkpoint, sending only what arrived since', async () => {
    await seed(3);
    await exportAuditTrail(recorder(), { endpoint: 'http://c', resource });
    await seed(2);

    const exp = recorder();
    const result = await exportAuditTrail(exp, { endpoint: 'http://c', resource });

    expect(result.sent).toBe(2);
    expect(exp.seen.flatMap((b) => b.records.map((r) => r.detail?.tool))).toEqual(['T0', 'T1']);
  });

  it('does not advance the checkpoint past a batch the collector refused', async () => {
    // The property the whole design exists for: a failed batch must be offered
    // again, never skipped, or the trail has a hole nothing reports.
    await seed(6);
    const failing = recorder(2);

    const result = await exportAuditTrail(failing, {
      endpoint: 'http://c',
      resource,
      batchSize: 2,
    });

    expect(result.stoppedBecause).toContain('collector down');
    expect(result.sent).toBe(2);
    expect(await readCheckpoint('rec', 'http://c')).toMatchObject({ seq: 1 });

    const retry = recorder();
    const second = await exportAuditTrail(retry, {
      endpoint: 'http://c',
      resource,
      batchSize: 2,
    });

    expect(second.sent).toBe(4);
    const tools = retry.seen.flatMap((b) => b.records.map((r) => r.detail?.tool));
    expect(tools).toEqual(['T2', 'T3', 'T4', 'T5']);
  });

  it('stops at the first failure rather than skipping ahead to later batches', async () => {
    await seed(6);
    const failing = recorder(1);

    await exportAuditTrail(failing, { endpoint: 'http://c', resource, batchSize: 2 });

    expect(failing.seen).toHaveLength(1);
    expect(await readCheckpoint('rec', 'http://c')).toBeNull();
  });

  it('keeps checkpoints per destination, so one collector being down does not stall another', async () => {
    await seed(3);
    await exportAuditTrail(recorder(), { endpoint: 'http://a', resource });

    const b = recorder();
    const result = await exportAuditTrail(b, { endpoint: 'http://b', resource });

    expect(result.sent).toBe(3);
  });

  it('respects the batch size', async () => {
    await seed(5);
    const exp = recorder();

    await exportAuditTrail(exp, { endpoint: 'http://c', resource, batchSize: 2 });

    expect(exp.seen.map((b) => b.records.length)).toEqual([2, 2, 1]);
  });

  it('carries the resource on every batch, so a collector can tell hosts apart', async () => {
    await seed(3);
    const exp = recorder();

    await exportAuditTrail(exp, { endpoint: 'http://c', resource, batchSize: 2 });

    expect(exp.seen.every((b) => b.resource.host === 'h1')).toBe(true);
  });

  it('stops on an abort signal without losing its place', async () => {
    await seed(4);
    const ac = new AbortController();
    ac.abort();

    const result = await exportAuditTrail(recorder(), {
      endpoint: 'http://c',
      resource,
      signal: ac.signal,
    });

    expect(result.stoppedBecause).toBe('aborted');
    expect(result.sent).toBe(0);
  });
});

describe('pendingExportCount', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-export-'));
    prevHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    resetAuditHeadForTests();
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    resetAuditHeadForTests();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('counts what a run would send, without sending it', async () => {
    for (let i = 0; i < 4; i++) {
      await appendAuditRecord({
        ts: 1_700_000_000_000,
        sessionId: 's1' as never,
        turnId: 't1' as never,
        action: 'prompt',
        eventType: 'user_prompt',
      });
    }

    expect(await pendingExportCount('rec', 'http://c')).toBe(4);

    await exportAuditTrail(recorder(), { endpoint: 'http://c', resource });

    expect(await pendingExportCount('rec', 'http://c')).toBe(0);
  });
});
