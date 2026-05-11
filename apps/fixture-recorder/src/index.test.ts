import { describe, expect, it } from 'vitest';

describe('fixture-recorder argv parsing', () => {
  it('importable smoke test', async () => {
    // The module is mostly an orchestration script. We just verify it imports
    // cleanly and exposes `record`, so a broken entry point would fail CI.
    const mod = await import('./index.js');
    expect(typeof mod.record).toBe('function');
  });
});
