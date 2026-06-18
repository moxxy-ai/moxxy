import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// prefs.ts derives its path from homedir(); point it at a throwaway dir.
let tmp: string;
vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof import('node:os')>();
  return { ...actual, homedir: () => tmp };
});

import { readPrefs, updatePrefs } from './prefs';

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
  rmSync(tmp, { recursive: true, force: true });
});

describe('readPrefs', () => {
  it('returns defaults when the file is missing', () => {
    const p = readPrefs();
    expect(p.onboardingComplete).toBe(false);
    expect(p.theme).toBe('system');
    expect(p.version).toBe(1);
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
  });

  it('forces version to 1 even if a stale file claims otherwise', () => {
    writePrefsFile({ version: 99 });
    expect(readPrefs().version).toBe(1);
  });
});

describe('updatePrefs', () => {
  it('persists a patch and returns the merged result', async () => {
    const next = await updatePrefs({ onboardingComplete: true });
    expect(next.onboardingComplete).toBe(true);
    // Persisted to disk atomically.
    const onDisk = JSON.parse(readFileSync(prefsPath(), 'utf8'));
    expect(onDisk.onboardingComplete).toBe(true);
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
