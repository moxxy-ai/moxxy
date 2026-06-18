import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadPreferences, preferencesPath, savePreferences } from './preferences.js';

// preferencesPath() resolves ~/.moxxy/preferences.json via os.homedir(), which
// derives from HOME (POSIX) / USERPROFILE (Windows). Point both at a tmpdir per
// test so the suite never touches the developer's real preferences file.
let tmpHome: string;
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-prefs-'));
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  await fs.mkdir(path.join(tmpHome, '.moxxy'), { recursive: true });
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

const readRaw = async (): Promise<unknown> =>
  JSON.parse(await fs.readFile(preferencesPath(), 'utf8'));

describe('preferences store', () => {
  it('resolves the path under the (overridden) home dir', () => {
    expect(preferencesPath()).toBe(path.join(tmpHome, '.moxxy', 'preferences.json'));
  });

  it('returns an empty object when the file is missing', async () => {
    expect(await loadPreferences()).toEqual({});
  });

  it('returns an empty object when the file is corrupt', async () => {
    await fs.writeFile(preferencesPath(), '{ not json', 'utf8');
    expect(await loadPreferences()).toEqual({});
  });

  it('round-trips a patch through disk', async () => {
    await savePreferences({ model: 'gpt-5.4-mini', providerName: 'openai' });
    const loaded = await loadPreferences();
    expect(loaded.model).toBe('gpt-5.4-mini');
    expect(loaded.providerName).toBe('openai');
  });

  it('merges a second patch without clobbering unrelated fields', async () => {
    await savePreferences({ providerName: 'openai' });
    await savePreferences({ model: 'gpt-5.4-mini' });
    const loaded = await loadPreferences();
    expect(loaded.providerName).toBe('openai');
    expect(loaded.model).toBe('gpt-5.4-mini');
  });

  it('migrates legacy mode names on load', async () => {
    // "tool-use" is the legacy id that migrateModeName maps to "default".
    await fs.writeFile(
      preferencesPath(),
      JSON.stringify({ mode: 'tool-use' }) + '\n',
      'utf8',
    );
    const loaded = await loadPreferences();
    expect(loaded.mode).toBe('default');
  });

  it('writes a trailing newline atomically (no partial file)', async () => {
    await savePreferences({ model: 'm1' });
    const raw = await fs.readFile(preferencesPath(), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ model: 'm1' });
  });

  it('serializes overlapping saves so no update is lost (invariant #5)', async () => {
    // Two patches firing concurrently each read-merge-write the same file.
    // Without the mutex the later writer clobbers the earlier writer's field.
    await Promise.all([
      savePreferences({ model: 'a' }),
      savePreferences({ mode: 'goal' }),
    ]);
    const loaded = await loadPreferences();
    expect(loaded.model).toBe('a');
    expect(loaded.mode).toBe('goal');
  });

  it('keeps ALL distinct keys present under many overlapping writers', async () => {
    const patches: Array<Partial<Record<`k${number}`, string>>> = [];
    for (let i = 0; i < 25; i++) patches.push({ [`k${i}`]: `v${i}` });
    // Fire all saves at once; each merges a distinct key.
    await Promise.all(
      patches.map((p) => savePreferences(p as Record<string, string>)),
    );
    const loaded = (await readRaw()) as Record<string, string>;
    for (let i = 0; i < 25; i++) {
      expect(loaded[`k${i}`]).toBe(`v${i}`);
    }
  });
});
