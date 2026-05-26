import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearUsageStats, loadUsageStats, mergeUsageStats } from './usage-stats.js';
import type { ModelUsageTotals } from '@moxxy/sdk';

const totals = (over: Partial<ModelUsageTotals> = {}): ModelUsageTotals => ({
  calls: 1,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  ...over,
});

let tmpDir: string;
let statsPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-usage-'));
  statsPath = path.join(tmpDir, 'usage.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('usage-stats store', () => {
  it('returns an empty aggregate when the file is missing', async () => {
    const file = await loadUsageStats(statsPath);
    expect(file.models).toEqual({});
    expect(file.version).toBe(1);
  });

  it('merges a delta and round-trips through disk', async () => {
    await mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 100, outputTokens: 10 }) }, statsPath);
    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(100);
    expect(file.models['anthropic/opus']!.firstSeen).toBeTruthy();
    expect(file.models['anthropic/opus']!.lastSeen).toBeTruthy();
  });

  it('accumulates additively across merges and preserves firstSeen', async () => {
    const first = await mergeUsageStats(
      { 'anthropic/opus': totals({ inputTokens: 100 }) },
      statsPath,
    );
    const firstSeen = first.models['anthropic/opus']!.firstSeen;

    await mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 50, calls: 2 }) }, statsPath);
    const file = await loadUsageStats(statsPath);

    expect(file.models['anthropic/opus']!.inputTokens).toBe(150);
    expect(file.models['anthropic/opus']!.calls).toBe(3);
    expect(file.models['anthropic/opus']!.firstSeen).toBe(firstSeen);
  });

  it('ignores empty deltas and zero-call entries', async () => {
    await mergeUsageStats({}, statsPath);
    expect((await loadUsageStats(statsPath)).models).toEqual({});

    await mergeUsageStats({ 'a/m': totals({ calls: 0, inputTokens: 5 }) }, statsPath);
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });

  it('clears the aggregate', async () => {
    await mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 100 }) }, statsPath);
    await clearUsageStats(statsPath);
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });

  it('reads as empty when the file is malformed', async () => {
    await fs.writeFile(statsPath, '{ not json', 'utf8');
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });
});
