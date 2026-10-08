import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// prefs.ts derives its path from homedir(); point it at a throwaway dir.
let tmp: string;
vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof import('node:os')>();
  return { ...actual, homedir: () => tmp };
});

import { readPrefs, updatePrefs } from './prefs';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

function prefsPath(): string {
  return path.join(tmp, '.moxxy', 'desktop', 'prefs.json');
}

function writePrefsFile(json: unknown): void {
  mkdirSync(path.dirname(prefsPath()), { recursive: true });
  writeFileSync(prefsPath(), JSON.stringify(json));
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'prefs-'));
});

afterEach(() => {
  removeDirSync(tmp);
});

describe('readPrefs', () => {
  it('returns defaults when the file is missing', () => {
    const p = readPrefs();
    expect(p.onboardingComplete).toBe(false);
    expect(p.theme).toBe('system');
    expect((p as { focusMiniTextSize?: unknown }).focusMiniTextSize).toBeNull();
    expect(p.version).toBe(1);
  });

  it('has the reply sound on until it is switched off, also for a file written before it existed', () => {
    expect(readPrefs().replySound).toBe(true);

    writePrefsFile({ onboardingComplete: true, theme: 'dark' });
    expect(readPrefs().replySound).toBe(true);

    writePrefsFile({ replySound: false });
    expect(readPrefs().replySound).toBe(false);
  });

  it('returns defaults for a malformed file (never throws)', () => {
    mkdirSync(path.dirname(prefsPath()), { recursive: true });
    writeFileSync(prefsPath(), '{not json');
    expect(readPrefs().onboardingComplete).toBe(false);
  });

  it('merges stored values over the defaults', () => {
    writePrefsFile({ onboardingComplete: true, theme: 'dark' });
    const p = readPrefs();
    expect(p.onboardingComplete).toBe(true);
    expect(p.theme).toBe('dark');
    // Unset fields still fall back to defaults.
    expect(p.clerkUserId).toBeNull();
    expect((p as { focusMiniTextSize?: unknown }).focusMiniTextSize).toBeNull();
  });

  it('defaults Voice Mode to the local engine and keeps a chosen GPT-Live engine', () => {
    expect(readPrefs().voiceEngine).toBe('local');
    writePrefsFile({ voiceEngine: 'gpt-live' });
    expect(readPrefs().voiceEngine).toBe('gpt-live');
  });

  it('forces version to 1 even if a stale file claims otherwise', () => {
    writePrefsFile({ version: 99 });
    expect(readPrefs().version).toBe(1);
  });
});

describe('updatePrefs', () => {
  it('persists a patch and returns the merged result', async () => {
    const next = await updatePrefs({
      onboardingComplete: true,
      focusMiniTextSize: { width: 720, height: 620 },
    });
    expect(next.onboardingComplete).toBe(true);
    expect((next as { focusMiniTextSize?: unknown }).focusMiniTextSize).toEqual({
      width: 720,
      height: 620,
    });
    // Persisted to disk atomically.
    const onDisk = JSON.parse(readFileSync(prefsPath(), 'utf8'));
    expect(onDisk.onboardingComplete).toBe(true);
    expect(onDisk.focusMiniTextSize).toEqual({ width: 720, height: 620 });
  });

  it('serializes concurrent updates so neither clobbers the other', async () => {
    await Promise.all([
      updatePrefs({ onboardingComplete: true }),
      updatePrefs({ mobileGatewayEnabled: true }),
    ]);
    const p = readPrefs();
    expect(p.onboardingComplete).toBe(true);
    expect(p.mobileGatewayEnabled).toBe(true);
  });
});
