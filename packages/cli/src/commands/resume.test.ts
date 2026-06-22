import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { cwdForResumeSession } from './resume';

describe('cwdForResumeSession', () => {
  it('returns the persisted session cwd before falling back to process cwd', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'moxxy-resume-cwd-'));
    const oldHome = process.env.HOME;
    process.env.HOME = root;
    try {
      const sessionsDir = path.join(root, '.moxxy', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(path.join(sessionsDir, 'session-resume.jsonl'), '{"type":"noop"}\n');
      writeFileSync(
        path.join(sessionsDir, 'session-resume.meta.json'),
        JSON.stringify({
          id: 'session-resume',
          cwd: path.join(root, 'original-cwd'),
          startedAt: '2026-06-12T10:00:00.000Z',
          lastActivity: '2026-06-12T10:05:00.000Z',
          eventCount: 1,
          firstPrompt: 'resume me',
          provider: null,
          model: null,
        }),
      );

      await expect(cwdForResumeSession('session-resume', '/fallback')).resolves.toBe(
        path.join(root, 'original-cwd'),
      );
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
    }
  });
});
