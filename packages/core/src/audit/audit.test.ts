import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditRecord, MoxxyEvent, UnchainedAuditRecord } from '@moxxy/sdk';
import { EventLog } from '../events/log.js';
import { Session } from '../session.js';
import { silentLogger } from '../logger.js';
import { chainRecord, verifyChain } from './chain.js';
import { projectAuditRecord } from './project.js';
import {
  appendAuditRecord,
  auditDir,
  jsonlAuditSink,
  listAuditDays,
  pruneAuditDays,
  readAuditDay,
  resetAuditHeadForTests,
  verifyAuditDay,
} from './jsonl-audit-sink.js';
import { attachAuditSink } from './attach.js';

const base = (over: Partial<UnchainedAuditRecord> = {}): UnchainedAuditRecord => ({
  ts: 1_700_000_000_000,
  sessionId: 's1' as never,
  turnId: 't1' as never,
  action: 'prompt',
  eventType: 'user_prompt',
  ...over,
});

describe('chainRecord / verifyChain', () => {
  const chain = (n: number): AuditRecord[] => {
    const out: AuditRecord[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const rec = chainRecord(base({ ts: 1_700_000_000_000 + i }), i, prev);
      out.push(rec);
      prev = rec.hash;
    }
    return out;
  };

  it('verifies an intact chain and reports its head', () => {
    const records = chain(5);
    const verdict = verifyChain(records);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.count).toBe(5);
      expect(verdict.head).toBe(records[4]!.hash);
    }
  });

  it('an empty chain is valid with a null head', () => {
    const verdict = verifyChain([]);
    expect(verdict).toEqual({ ok: true, count: 0, head: null });
  });

  // The realistic threat: someone quietly drops the one line recording what
  // they did. Every later hash must stop matching.
  it('detects a removed record', () => {
    const records = chain(5);
    const tampered = [...records.slice(0, 2), ...records.slice(3)];
    const verdict = verifyChain(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.brokenAt).toBe(2);
  });

  it('detects an altered record', () => {
    const records = chain(3);
    records[1] = { ...records[1]!, action: 'tool.result' };
    const verdict = verifyChain(records);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('altered');
  });

  it('detects reordering', () => {
    const records = chain(3);
    const verdict = verifyChain([records[0]!, records[2]!, records[1]!]);
    expect(verdict.ok).toBe(false);
  });

  // Two records with identical content but different key insertion order must
  // hash identically, or verification breaks the moment one round-trips
  // through a different serializer.
  it('hashes independently of detail key order', () => {
    const a = chainRecord(base({ detail: { alpha: 1, beta: 2 } }), 0, null);
    const b = chainRecord(base({ detail: { beta: 2, alpha: 1 } }), 0, null);
    expect(a.hash).toBe(b.hash);
  });

  it('a different actor produces a different hash', () => {
    const a = chainRecord(base(), 0, null);
    const b = chainRecord(
      base({ actor: { id: 'alice', kind: 'human', issuer: 'os' } }),
      0,
      null,
    );
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('projectAuditRecord', () => {
  const event = (over: Partial<MoxxyEvent>): MoxxyEvent =>
    ({
      id: 'e1',
      seq: 0,
      ts: 1,
      sessionId: 's1',
      turnId: 't1',
      source: 'user',
      ...over,
    }) as MoxxyEvent;

  it('skips conversation-only events', () => {
    expect(projectAuditRecord(event({ type: 'assistant_chunk', text: 'hi' } as never))).toBeNull();
    expect(projectAuditRecord(event({ type: 'provider_request' } as never))).toBeNull();
  });

  // A prompt's business content has no reason to leave the machine, but a
  // specific prompt must still be provable against the trail.
  it('records a prompt as length + hash, not text, by default', () => {
    const rec = projectAuditRecord(event({ type: 'user_prompt', text: 'launch the missiles' } as never));
    expect(rec?.detail?.chars).toBe(19);
    expect(rec?.detail?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec?.detail?.text).toBeUndefined();
  });

  it('records prompt text when the operator opts in, redacted', () => {
    const rec = projectAuditRecord(
      event({ type: 'user_prompt', text: 'use token ghp_ABCDEFGHIJKLMNOPQRST' } as never),
      { includePromptText: true },
    );
    expect(rec?.detail?.text).toContain('[redacted]');
    expect(rec?.detail?.text).not.toContain('ABCDEFGHIJKLMNOPQRST');
  });

  it('flags an ambient trigger, since no human typed it', () => {
    const rec = projectAuditRecord(
      event({
        type: 'user_prompt',
        text: 'go',
        origin: { kind: 'webhook', name: 'deploy' },
      } as never),
    );
    expect(rec?.detail?.origin).toBe('webhook:deploy');
  });

  // The carrier field is named `command`, so a key-name-only redactor prints
  // the bearer token verbatim.
  it('redacts secrets inside a tool input while keeping a provable hash', () => {
    const rec = projectAuditRecord(
      event({
        type: 'tool_call_requested',
        callId: 'c1',
        name: 'bash',
        input: { command: 'curl -H "Authorization: Bearer sk-ant-SECRETVALUE123456"' },
      } as never),
    );
    expect(rec?.action).toBe('tool.request');
    expect(String(rec?.detail?.input)).not.toContain('SECRETVALUE123456');
    expect(String(rec?.detail?.input)).toContain('[redacted]');
    expect(rec?.detail?.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries the actor through', () => {
    const actor = { id: 'alice@host', kind: 'human', issuer: 'os' } as const;
    const rec = projectAuditRecord(event({ type: 'user_prompt', text: 'x', actor } as never));
    expect(rec?.actor).toEqual(actor);
  });

  it('records a denial with its reason', () => {
    const rec = projectAuditRecord(
      event({ type: 'tool_call_denied', callId: 'c1', decidedBy: 'policy', reason: 'blocked' } as never),
    );
    expect(rec?.action).toBe('tool.denied');
    expect(rec?.detail?.reason).toBe('blocked');
  });
});

describe('local audit sink', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-audit-'));
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

  const today = (): string => new Date().toISOString().slice(0, 10);

  it('appends a verifiable chain', async () => {
    for (let i = 0; i < 3; i++) expect(await appendAuditRecord(base())).toBe(true);
    const verdict = await verifyAuditDay(today());
    expect(verdict.ok).toBe(true);
    expect(verdict.count).toBe(3);
  });

  it('writes the trail owner-only', async () => {
    if (process.platform === 'win32') return;
    await appendAuditRecord(base());
    expect((await fs.stat(auditDir())).mode & 0o777).toBe(0o700);
    const file = path.join(auditDir(), `${today()}.jsonl`);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  // A restart (or a second moxxy process) must continue the day's chain rather
  // than restarting at seq 0, which would look exactly like tampering.
  it('resumes an existing day instead of forking the chain', async () => {
    await appendAuditRecord(base());
    await appendAuditRecord(base());
    resetAuditHeadForTests();
    await appendAuditRecord(base());

    const records = await readAuditDay(today());
    expect(records.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(records).ok).toBe(true);
  });

  // The chain is sequential: two writers reading prevHash before either
  // appends would both claim the same predecessor.
  it('keeps the chain intact under concurrent appends', async () => {
    await Promise.all(Array.from({ length: 20 }, () => appendAuditRecord(base())));
    const verdict = await verifyAuditDay(today());
    expect(verdict.ok).toBe(true);
    expect(verdict.count).toBe(20);
  });

  it('a truncated final line does not stop the rest from being read', async () => {
    await appendAuditRecord(base());
    const file = path.join(auditDir(), `${today()}.jsonl`);
    await fs.appendFile(file, '{"partial":', 'utf8');
    expect((await readAuditDay(today())).length).toBe(1);
  });

  it('prunes days past the retention window and keeps the rest', async () => {
    await appendAuditRecord(base());
    const old = path.join(auditDir(), '2020-01-01.jsonl');
    await fs.writeFile(old, '');
    expect(await pruneAuditDays(30)).toEqual(['2020-01-01']);
    expect(await listAuditDays()).toEqual([today()]);
  });

  it('treats a non-positive retention as "keep everything"', async () => {
    await appendAuditRecord(base());
    expect(await pruneAuditDays(0)).toEqual([]);
    expect(await listAuditDays()).toHaveLength(1);
  });
});

describe('attachAuditSink', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-audit-attach-'));
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

  it('records auditable events and ignores conversation', async () => {
    const session = new Session({ cwd: '/tmp', logger: silentLogger, log: new EventLog() });
    session.setPrincipal({ id: 'alice@host', kind: 'human', issuer: 'os' });
    const handle = attachAuditSink(session, jsonlAuditSink, { logger: silentLogger });

    await session.log.append({
      type: 'user_prompt', sessionId: session.id, turnId: 't1' as never, source: 'user', text: 'hi',
    });
    await session.log.append({
      type: 'assistant_chunk', sessionId: session.id, turnId: 't1' as never, source: 'model', text: 'yo',
    } as never);
    await handle.close();

    const records = await readAuditDay(new Date().toISOString().slice(0, 10));
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe('prompt');
    expect(records[0]!.actor?.id).toBe('alice@host');
  });

  // A failing sink must degrade loudly, never take down the turn it records.
  it('survives a sink that throws and reports itself degraded', async () => {
    const session = new Session({ cwd: '/tmp', logger: silentLogger, log: new EventLog() });
    const handle = attachAuditSink(
      session,
      {
        name: 'exploding',
        open: () => ({
          write: () => Promise.reject(new Error('sink is down')),
          close: async () => {},
        }),
      },
      { logger: silentLogger },
    );

    await expect(
      session.log.append({
        type: 'user_prompt', sessionId: session.id, turnId: 't1' as never, source: 'user', text: 'hi',
      }),
    ).resolves.toBeDefined();
    await handle.close();
    expect(handle.degraded).toBe(true);
  });

  it('stops recording after close', async () => {
    const session = new Session({ cwd: '/tmp', logger: silentLogger, log: new EventLog() });
    const handle = attachAuditSink(session, jsonlAuditSink, { logger: silentLogger });
    await handle.close();
    await session.log.append({
      type: 'user_prompt', sessionId: session.id, turnId: 't1' as never, source: 'user', text: 'after',
    });
    expect(await readAuditDay(new Date().toISOString().slice(0, 10))).toHaveLength(0);
  });
});
