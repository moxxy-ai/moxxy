import { describe, expect, it } from 'vitest';
import type { View } from '../views';
import { DESTINATIONS, RUNNER_LOCKED_REASON, isRunnerLocked, viewOf } from './destinations';

/** Every view, as a record so the compiler fails this file when a view is added. */
const EVERY_VIEW: Record<View, true> = {
  chat: true,
  extensions: true,
  collaborate: true,
  automations: true,
  apps: true,
  channels: true,
  mobile: true,
  settings: true,
};

describe('destinations', () => {
  it('lists every view exactly once, so nothing is reachable from somewhere else', () => {
    const views = DESTINATIONS.map((d) => d.id).filter((id) => id !== 'voice');
    expect([...views].sort()).toEqual(Object.keys(EVERY_VIEW).sort());
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
  });

  it('names them in the product vocabulary, runs first and settings last', () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual([
      'Runs',
      'Extensions',
      'Collaborate',
      'Automations',
      'Apps',
      'Channels',
      'Mobile',
      'Voice',
      'Settings',
    ]);
  });

  it('keeps voice as an action on the run, not a view of its own', () => {
    expect(viewOf('voice')).toBe('chat');
    expect(viewOf('settings')).toBe('settings');
  });

  it('locks the places that need a loaded session, and says why', () => {
    const locked = DESTINATIONS.filter((d) => isRunnerLocked(d.id)).map((d) => d.id);
    expect(locked).toEqual(['collaborate', 'automations', 'apps']);
    expect(RUNNER_LOCKED_REASON).toMatch(/loading this session/);
  });
});
