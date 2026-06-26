import { describe, expect, it } from 'vitest';
import type { ChannelRunStatus } from '@moxxy/sdk';
import { formatUptime, renderBuffer, statusLabel } from './ChannelsPanel.js';

const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();

describe('statusLabel', () => {
  const running: ChannelRunStatus = { name: 'slack', pid: 7, startedAt: iso(2_000) };

  it('shows pid + uptime when running (regardless of vault/configured)', () => {
    expect(statusLabel(running, undefined, false)).toMatch(/^running · pid 7 · up \d/);
  });

  it('says "needs config" only when the vault is present and required keys are missing', () => {
    expect(statusLabel(null, false, true)).toBe('needs config');
  });

  it('says "ready · stopped" when configured but not running', () => {
    expect(statusLabel(null, true, true)).toBe('ready · stopped');
  });

  it('falls back to plain "stopped" with no vault (configured unknowable)', () => {
    expect(statusLabel(null, undefined, false)).toBe('stopped');
  });
});

describe('formatUptime', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatUptime(iso(5_000))).toMatch(/^\d+s$/);
    expect(formatUptime(iso(5 * 60_000))).toMatch(/^\d+m$/);
    expect(formatUptime(iso(2 * 3_600_000 + 5 * 60_000))).toMatch(/^2h \d+m$/);
  });

  it('returns an em dash for a future or unparseable timestamp', () => {
    expect(formatUptime(new Date(Date.now() + 60_000).toISOString())).toBe('—');
    expect(formatUptime('not-a-date')).toBe('—');
  });
});

describe('renderBuffer', () => {
  it('masks secret input and never echoes plaintext for secrets', () => {
    expect(renderBuffer('xoxb-123', true)).toBe('••••••••');
    expect(renderBuffer('plain', false)).toBe('plain');
    expect(renderBuffer('plain')).toBe('plain');
  });

  it('renders a single space when empty so the cursor stays visible', () => {
    expect(renderBuffer('', true)).toBe(' ');
    expect(renderBuffer('')).toBe(' ');
  });
});
