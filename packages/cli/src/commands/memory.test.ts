import { describe, expect, it, vi, afterEach } from 'vitest';
import type { MemoryType } from '@moxxy/plugin-memory';
import { formatRelative, formatSize, groupByType, mapBounded } from './memory.js';

/** Minimal stat object — groupByType only reads `entry.frontmatter.type`. */
function statOfType(type: MemoryType): Parameters<typeof groupByType>[0][number] {
  return { entry: { frontmatter: { type } } } as Parameters<typeof groupByType>[0][number];
}

describe('groupByType', () => {
  it('returns groups in the fixed fact/preference/project/reference order', () => {
    const stats = [
      statOfType('reference'),
      statOfType('fact'),
      statOfType('project'),
      statOfType('preference'),
    ];
    expect(groupByType(stats).map(([t]) => t)).toEqual([
      'fact',
      'preference',
      'project',
      'reference',
    ]);
  });

  it('omits empty groups', () => {
    const groups = groupByType([statOfType('fact'), statOfType('fact')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]![0]).toBe('fact');
    expect(groups[0]![1]).toHaveLength(2);
  });

  it('buckets an out-of-order (unmapped) type at the END, after the ordered groups', () => {
    // A type outside the `order` array is still grouped (via the `?? []`
    // fallback) but appended after the four ordered buckets.
    const odd = 'archive' as MemoryType;
    const groups = groupByType([statOfType(odd), statOfType('fact')]);
    expect(groups.map(([t]) => t)).toEqual(['fact', odd]);
  });
});

describe('formatSize', () => {
  it('renders bytes below 1KiB as Bytes', () => {
    expect(formatSize(0)).toBe('0B');
    expect(formatSize(1023)).toBe('1023B');
  });

  it('switches to KB at exactly 1024 bytes', () => {
    expect(formatSize(1024)).toBe('1.0KB');
    expect(formatSize(1024 * 1024 - 1)).toBe('1024.0KB');
  });

  it('switches to MB at exactly 1 MiB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0MB');
    expect(formatSize(1024 * 1024 * 3)).toBe('3.0MB');
  });
});

describe('mapBounded', () => {
  it('preserves input order in the output', async () => {
    const out = await mapBounded([1, 2, 3, 4, 5], async (n) => n * 10, 2);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency limit (bounds the fan-out so a huge store cannot EMFILE)', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 500 }, (_, i) => i);
    await mapBounded(
      items,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      },
      8,
    );
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('handles an empty input without issuing any work', async () => {
    let calls = 0;
    const out = await mapBounded([], async () => (calls += 1));
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('formatRelative', () => {
  const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
  afterEach(() => vi.useRealTimers());

  function ago(days: number): Date {
    return new Date(NOW - days * 24 * 60 * 60 * 1000);
  }

  it('crosses the today/1d/<30d/months/years boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelative(ago(0))).toBe('today');
    expect(formatRelative(ago(1))).toBe('1d ago');
    expect(formatRelative(ago(29))).toBe('29d ago');
    expect(formatRelative(ago(30))).toBe('1mo ago');
    expect(formatRelative(ago(359))).toBe('11mo ago');
    // months = floor(360/30) = 12, no longer < 12 → years: floor(360/365) = 0.
    expect(formatRelative(ago(360))).toBe('0y ago');
    expect(formatRelative(ago(365))).toBe('1y ago');
  });
});
