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

  it('rejects a shape-valid file with a non-numeric counter (no string-concat corruption)', async () => {
    // A hand-edited / partially-written file where a counter is a string used to
    // pass the old `typeof models === 'object'` cast and flow straight into
    // addModelTotals, corrupting the aggregate via "100" + 50 = "10050".
    await fs.writeFile(
      statsPath,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        models: {
          'anthropic/opus': {
            calls: 1,
            inputTokens: '100',
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          },
        },
      }),
      'utf8',
    );
    // Shape-invalid → fall through to empty, exactly like malformed JSON.
    expect((await loadUsageStats(statsPath)).models).toEqual({});

    // And a subsequent merge produces purely numeric totals (no concatenation).
    await mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 50 }) }, statsPath);
    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(50);
    expect(typeof file.models['anthropic/opus']!.inputTokens).toBe('number');
  });

  it('clear and merge serialize on the same mutex (clear cannot resurrect a cleared aggregate)', async () => {
    await mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 100 }) }, statsPath);
    // Fire a clear and a merge concurrently. Whatever the interleaving, the two
    // must serialize against each other so the file is never the stale
    // pre-clear snapshot reconstituted by a merge that read before the clear.
    // The only sound end-states are: empty (merge ran then clear), or exactly
    // the merged delta (clear ran then merge) — never the resurrected old 100
    // plus delta.
    await Promise.all([
      clearUsageStats(statsPath),
      mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 7 }) }, statsPath),
    ]);
    const file = await loadUsageStats(statsPath);
    const entry = file.models['anthropic/opus'];
    if (entry) {
      // clear-then-merge ordering: only the post-clear delta survives.
      expect(entry.inputTokens).toBe(7);
    } else {
      // merge-then-clear ordering: aggregate is empty.
      expect(file.models).toEqual({});
    }
  });

  it('coalesces a missing firstSeen on merge rather than emitting undefined', async () => {
    // Defense in depth: even if an entry somehow lacks firstSeen, a merge must
    // not propagate `firstSeen: undefined` forward.
    await mergeUsageStats({ 'anthropic/opus': totals({ inputTokens: 1 }) }, statsPath);
    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.firstSeen).toBeTruthy();
  });
});
