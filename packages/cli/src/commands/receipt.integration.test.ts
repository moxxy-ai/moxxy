import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendAuditRecord, auditDir, resetAuditHeadForTests } from '@moxxy/core';
import { parseArgv } from '../argv.js';
import { runReceiptCommand } from './receipt.js';

/**
 * The guarantee worth an integration test: a receipt read back off disk must
 * refuse to look complete after a record is removed. The unit tests cover the
 * projection; only this covers the chain actually being checked on the way in.
 */
describe('moxxy receipt against a real trail', () => {
  let home: string;
  let prevHome: string | undefined;
  let out: string[];

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-receipt-'));
    prevHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    resetAuditHeadForTests();
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    resetAuditHeadForTests();
    await fs.rm(home, { recursive: true, force: true });
  });

  const seed = async (): Promise<void> => {
    const actor = { id: 'alice@host', kind: 'human' as const, issuer: 'os' };
    const base = { sessionId: 's1' as never, turnId: 't1' as never, actor };
    await appendAuditRecord({
      ...base,
      ts: 1,
      action: 'policy',
      eventType: 'plugin_registered',
      detail: { fingerprint: 'deadbeefcafe0000' },
    });
    for (const tool of ['Read', 'Bash', 'Write']) {
      await appendAuditRecord({
        ...base,
        ts: 2,
        action: 'tool.request',
        eventType: 'tool_call_requested',
        detail: { tool },
      });
    }
    await appendAuditRecord({
      ...base,
      ts: 3,
      action: 'usage',
      eventType: 'provider_response',
      detail: { inputTokens: 1200, outputTokens: 340 },
    });
  };

  const dayFile = async (): Promise<string> => {
    const dir = auditDir();
    const [name] = await fs.readdir(dir);
    return path.join(dir, name!);
  };

  it('assembles a verified receipt and exits 0', async () => {
    await seed();

    const code = await runReceiptCommand(parseArgv(['receipt', 't1', '--json']));

    expect(code).toBe(0);
    const receipt = JSON.parse(out.join(''));
    expect(receipt.actor).toBe('os:alice@host');
    expect(receipt.toolsRequested).toEqual(['Read', 'Bash', 'Write']);
    expect(receipt.policyFingerprint).toBe('deadbeefcafe0000');
    expect(receipt.tokens).toEqual({ input: 1200, output: 340 });
    expect(receipt.chainVerified).toBe(true);
  });

  it('flags a removed record instead of reporting the surviving subset as whole', async () => {
    await seed();
    const file = await dayFile();
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    // Drop the Bash request: silent selective deletion, the realistic threat.
    await fs.writeFile(file, [...lines.slice(0, 2), ...lines.slice(3)].join('\n') + '\n');

    const code = await runReceiptCommand(parseArgv(['receipt', 't1', '--json']));

    const receipt = JSON.parse(out.join(''));
    expect(receipt.toolsRequested).not.toContain('Bash');
    expect(receipt.chainVerified).toBe(false);
    // Non-zero so a compliance job gates on trustworthiness, not existence.
    expect(code).toBe(1);
  });

  it('refuses rather than inventing an empty receipt for an unknown turn', async () => {
    await seed();

    expect(await runReceiptCommand(parseArgv(['receipt', 'no-such-turn']))).toBe(1);
    expect(out.join('')).toBe('');
  });
});
