import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { setupSessionWithConfig } from '../setup.js';

it('restores the saved model when explicitly resuming a conversation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-resume-model-'));
  vi.stubEnv('MOXXY_HOME', home);
  try {
    const id = 'saved-conversation';
    const dir = path.join(home, 'sessions');
    await mkdir(dir);
    const ts = '2026-11-18T10:00:00.000Z';
    await writeFile(path.join(dir, id + '.jsonl'), JSON.stringify({
      type: 'user_prompt', id: 'e1', seq: 0, sessionId: id, turnId: 'first', ts: Date.parse(ts), source: 'user', text: 'hello',
    }) + '\n');
    await writeFile(path.join(dir, id + '.json'), JSON.stringify({
      id, cwd: home, version: 1, startedAt: ts, lastActivity: ts, eventCount: 1, provider: null, model: 'saved-model',
    }));
    const { session } = await setupSessionWithConfig({
      cwd: home, resumeSessionId: id, skipUserConfig: true, skipKeyPrompt: true,
      tolerateNoProvider: true, skipInitHooks: true, disableSessionPersistence: true, disableKeytar: true,
    });
    try {
      expect(session.lastResolvedModel).toBe('saved-model');
    } finally {
      await session.close();
    }
  } finally {
    vi.unstubAllEnvs();
    await removeDir(home);
  }
});
