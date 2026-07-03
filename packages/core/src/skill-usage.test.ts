import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSkillUsage, mergeSkillUsage } from './skill-usage.js';

let tmpDir: string;
let usagePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-skill-usage-'));
  usagePath = path.join(tmpDir, 'usage.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('skill-usage store', () => {
  it('returns an empty aggregate when the file is missing', async () => {
    const file = await loadSkillUsage(usagePath);
    expect(file.skills).toEqual({});
    expect(file.version).toBe(1);
  });

  it('merges a delta and round-trips through disk', async () => {
    await mergeSkillUsage(
      { 'deploy-app': { invocations: 2, lastInvokedAt: '2026-07-03T10:00:00.000Z' } },
      usagePath,
    );
    const file = await loadSkillUsage(usagePath);
    expect(file.skills['deploy-app']!.invocations).toBe(2);
    expect(file.skills['deploy-app']!.lastInvokedAt).toBe('2026-07-03T10:00:00.000Z');
  });

  it('accumulates invocations across merges and advances lastInvokedAt', async () => {
    await mergeSkillUsage(
      { 'deploy-app': { invocations: 1, lastInvokedAt: '2026-07-01T00:00:00.000Z' } },
      usagePath,
    );
    await mergeSkillUsage(
      { 'deploy-app': { invocations: 3, lastInvokedAt: '2026-07-02T00:00:00.000Z' } },
      usagePath,
    );
    const file = await loadSkillUsage(usagePath);
    expect(file.skills['deploy-app']!.invocations).toBe(4);
    // The later timestamp wins even if a merge arrives out of order.
    expect(file.skills['deploy-app']!.lastInvokedAt).toBe('2026-07-02T00:00:00.000Z');
  });

  it('keeps the earliest createdAt and never lets a later merge overwrite it', async () => {
    await mergeSkillUsage(
      { 'deploy-app': { invocations: 0, createdAt: '2026-06-01T00:00:00.000Z' } },
      usagePath,
    );
    await mergeSkillUsage(
      { 'deploy-app': { invocations: 1, createdAt: '2026-07-01T00:00:00.000Z' } },
      usagePath,
    );
    const file = await loadSkillUsage(usagePath);
    expect(file.skills['deploy-app']!.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(file.skills['deploy-app']!.invocations).toBe(1);
  });

  it('does not advance lastInvokedAt when an out-of-order (earlier) delta arrives', async () => {
    await mergeSkillUsage(
      { s: { invocations: 1, lastInvokedAt: '2026-07-05T00:00:00.000Z' } },
      usagePath,
    );
    await mergeSkillUsage(
      { s: { invocations: 1, lastInvokedAt: '2026-07-01T00:00:00.000Z' } },
      usagePath,
    );
    const file = await loadSkillUsage(usagePath);
    expect(file.skills['s']!.lastInvokedAt).toBe('2026-07-05T00:00:00.000Z');
    expect(file.skills['s']!.invocations).toBe(2);
  });

  it('an empty delta is a no-op read (does not create the file)', async () => {
    const file = await mergeSkillUsage({}, usagePath);
    expect(file.skills).toEqual({});
    await expect(fs.access(usagePath)).rejects.toThrow();
  });

  it('falls back to empty on a corrupt (unparseable) file', async () => {
    await fs.writeFile(usagePath, '{ this is not json');
    expect((await loadSkillUsage(usagePath)).skills).toEqual({});
  });

  it('falls back to empty on a shape-invalid file (non-numeric counter)', async () => {
    // A hand-edited file with a string counter must not flow into the additive
    // merge (which would corrupt the aggregate via string concatenation).
    await fs.writeFile(
      usagePath,
      JSON.stringify({ version: 1, updatedAt: 'x', skills: { s: { invocations: '5' } } }),
    );
    expect((await loadSkillUsage(usagePath)).skills).toEqual({});
    // A subsequent merge therefore starts fresh rather than concatenating.
    await mergeSkillUsage({ s: { invocations: 2 } }, usagePath);
    expect((await loadSkillUsage(usagePath)).skills['s']!.invocations).toBe(2);
  });
});
