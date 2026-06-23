import { describe, expect, it } from 'vitest';
import { shouldShowHistoryLoader } from '../src/hooks/useHistoryLoading';

describe('shouldShowHistoryLoader', () => {
  const base = { sessionKey: 'sess-1', itemCount: 0, eventCount: 0, expired: false };

  it('does NOT load a fresh session (no events) — shows the welcome', () => {
    expect(shouldShowHistoryLoader({ ...base, eventCount: 0 })).toBe(false);
  });

  it('loads a session that has events but no transcript yet', () => {
    expect(shouldShowHistoryLoader({ ...base, eventCount: 12, itemCount: 0 })).toBe(true);
  });

  it('stops loading once transcript items have streamed in', () => {
    expect(shouldShowHistoryLoader({ ...base, eventCount: 12, itemCount: 4 })).toBe(false);
  });

  it('gives up (safety cap) so the loader can never stick', () => {
    expect(shouldShowHistoryLoader({ ...base, eventCount: 12, itemCount: 0, expired: true })).toBe(false);
  });

  it('never loads without an active session', () => {
    expect(shouldShowHistoryLoader({ ...base, sessionKey: null, eventCount: 12 })).toBe(false);
  });
});
