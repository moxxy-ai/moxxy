/**
 * Derived session titles:
 *   1. Auto-named sessions ("Session N") display their first prompt.
 *   2. User-renamed sessions are never overridden.
 *   3. Missing / corrupt / promptless sidecars keep the stored name.
 *   4. Titles are single-line and length-capped.
 *   5. Nothing is written back (display-only).
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import {
  titleFromFirstPrompt,
  withSessionTitles,
  withSessionTitlesOverview,
} from './session-titles';

async function metaDir(
  sidecars: Record<string, unknown>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'session-titles-'));
  for (const [id, meta] of Object.entries(sidecars)) {
    const body = typeof meta === 'string' ? meta : JSON.stringify(meta);
    await writeFile(path.join(dir, `${id}.meta.json`), body, 'utf8');
  }
  return dir;
}

function desk(sessions: Array<{ id: string; name: string }>): Desk {
  return {
    id: 'desk-1',
    name: 'Desk',
    cwd: '/tmp',
    color: '#3b82f6',
    createdAt: 1,
    sessions: sessions.map((s) => ({ ...s, createdAt: 1 })),
    activeSessionId: sessions[0]?.id ?? 'desk-1',
  };
}

describe('titleFromFirstPrompt', () => {
  it('squashes whitespace to one line and trims', () => {
    expect(titleFromFirstPrompt('  fix the\n  login\tbug  ')).toBe('fix the login bug');
  });

  it('caps long prompts with an ellipsis', () => {
    const long = 'a'.repeat(100);
    const title = titleFromFirstPrompt(long)!;
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith('…')).toBe(true);
  });

  it('returns null for empty / non-string values', () => {
    expect(titleFromFirstPrompt('')).toBeNull();
    expect(titleFromFirstPrompt('   \n ')).toBeNull();
    expect(titleFromFirstPrompt(null)).toBeNull();
    expect(titleFromFirstPrompt(42)).toBeNull();
  });
});

describe('withSessionTitles', () => {
  it('re-titles auto-named sessions from their sidecar first prompt', async () => {
    const dir = await metaDir({
      's-1': { id: 's-1', firstPrompt: 'refactor the auth flow' },
    });
    const [out] = await withSessionTitles([desk([{ id: 's-1', name: 'Session 1' }])], dir);
    expect(out!.sessions[0]!.name).toBe('refactor the auth flow');
  });

  it('never overrides a user-set name', async () => {
    const dir = await metaDir({
      's-1': { id: 's-1', firstPrompt: 'refactor the auth flow' },
    });
    const [out] = await withSessionTitles([desk([{ id: 's-1', name: 'My research' }])], dir);
    expect(out!.sessions[0]!.name).toBe('My research');
  });

  it('keeps the stored name when the sidecar is missing, corrupt, or promptless', async () => {
    const dir = await metaDir({
      corrupt: 'not json{{',
      promptless: { id: 'promptless', firstPrompt: null },
    });
    const [out] = await withSessionTitles(
      [
        desk([
          { id: 'absent', name: 'Session 1' },
          { id: 'corrupt', name: 'Session 2' },
          { id: 'promptless', name: 'Session 3' },
        ]),
      ],
      dir,
    );
    expect(out!.sessions.map((s) => s.name)).toEqual([
      'Session 1',
      'Session 2',
      'Session 3',
    ]);
  });

  it('is display-only — the sidecar is not rewritten', async () => {
    const dir = await metaDir({
      's-1': { id: 's-1', firstPrompt: 'hello world' },
    });
    const before = await readFile(path.join(dir, 's-1.meta.json'), 'utf8');
    await withSessionTitles([desk([{ id: 's-1', name: 'Session 1' }])], dir);
    const after = await readFile(path.join(dir, 's-1.meta.json'), 'utf8');
    expect(after).toBe(before);
  });
});

describe('withSessionTitlesOverview', () => {
  it('re-titles the flat sessions.list shape too', async () => {
    const dir = await metaDir({
      's-1': { id: 's-1', firstPrompt: 'plan the launch' },
    });
    const out = await withSessionTitlesOverview(
      {
        sessions: [
          { id: 's-1', name: 'Session 1', createdAt: 1 },
          { id: 's-2', name: 'Renamed', createdAt: 2 },
        ],
        activeSessionId: 's-1',
      },
      dir,
    );
    expect(out.sessions.map((s) => s.name)).toEqual(['plan the launch', 'Renamed']);
    expect(out.activeSessionId).toBe('s-1');
  });
});
