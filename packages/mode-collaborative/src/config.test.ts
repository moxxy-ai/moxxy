import { describe, expect, it } from 'vitest';
import { DEFAULT_COLLAB_CONFIG, resolveCollabConfig } from './config.js';

describe('resolveCollabConfig', () => {
  it('returns defaults with no input', () => {
    expect(resolveCollabConfig()).toEqual(DEFAULT_COLLAB_CONFIG);
  });

  it('layers persisted preferences over defaults', () => {
    const cfg = resolveCollabConfig({ maxAgents: 3, mergePolicy: 'stage-only' });
    expect(cfg.maxAgents).toBe(3);
    expect(cfg.mergePolicy).toBe('stage-only');
    expect(cfg.concurrency).toBe('parallel'); // untouched default
  });

  it('lets a per-run override win over persisted', () => {
    const cfg = resolveCollabConfig({ maxAgents: 3 }, { maxAgents: 2, verifyGate: true });
    expect(cfg.maxAgents).toBe(2);
    expect(cfg.verifyGate).toBe(true);
  });

  it('ignores invalid persisted values', () => {
    const cfg = resolveCollabConfig({ maxAgents: 999, mergePolicy: 'nonsense' });
    expect(cfg).toEqual(DEFAULT_COLLAB_CONFIG);
  });
});
