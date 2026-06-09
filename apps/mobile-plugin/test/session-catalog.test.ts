import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionCatalog } from '../src/session-catalog.js';

describe('mobile session catalog', () => {
  it('reads persisted Moxxy sessions from sidecars sorted by last activity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-sessions-'));
    try {
      await writeSession(dir, {
        id: 'session-old',
        cwd: '/work/old',
        startedAt: '2026-06-08T10:00:00.000Z',
        lastActivity: '2026-06-08T10:20:00.000Z',
        eventCount: 2,
        firstPrompt: 'Old work',
        provider: 'openai-codex',
        model: 'gpt-5',
      });
      await writeSession(dir, {
        id: 'session-new',
        cwd: '/work/new',
        startedAt: '2026-06-09T10:00:00.000Z',
        lastActivity: '2026-06-09T10:20:00.000Z',
        eventCount: 1,
        firstPrompt: 'New work',
        provider: null,
        model: null,
      });
      await writeFile(join(dir, 'orphan.meta.json'), JSON.stringify({
        id: 'orphan',
        cwd: '/missing-log',
        startedAt: '2026-06-09T09:00:00.000Z',
        lastActivity: '2026-06-09T09:00:00.000Z',
        eventCount: 1,
      }));

      const catalog = createSessionCatalog({ dir });

      expect(catalog.listSessions().map((session: { readonly id: string }) => session.id)).toEqual(['session-new', 'session-old']);
      expect(catalog.listSessions()[0]).toMatchObject({
        id: 'session-new',
        cwd: '/work/new',
        eventCount: 1,
        firstPrompt: 'New work',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('restores a session event log while skipping malformed lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-events-'));
    try {
      await writeSession(dir, {
        id: 'session-old',
        cwd: '/work/old',
        startedAt: '2026-06-08T10:00:00.000Z',
        lastActivity: '2026-06-08T10:20:00.000Z',
        eventCount: 2,
        firstPrompt: 'Old work',
        provider: 'openai-codex',
        model: 'gpt-5',
      }, [
        { type: 'user_prompt', text: 'old question' },
        'not-json',
        { type: 'assistant_message', content: 'old answer' },
      ]);

      const catalog = createSessionCatalog({ dir });

      expect(catalog.readSessionEvents('session-old')).toEqual([
        { type: 'user_prompt', text: 'old question' },
        { type: 'assistant_message', content: 'old answer' },
      ]);
      expect(catalog.hasSession('session-old')).toBe(true);
      expect(catalog.hasSession('missing')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('derives visible session metadata from logs when the sidecar is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-events-no-meta-'));
    try {
      await writeFile(
        join(dir, 'log-only.jsonl'),
        [
          JSON.stringify({ type: 'assistant_message', content: 'boot', ts: '2026-06-09T08:00:00.000Z' }),
          JSON.stringify({ type: 'user_prompt', text: 'Recovered prompt from log', ts: '2026-06-09T08:01:00.000Z' }),
          JSON.stringify({ type: 'assistant_message', content: 'answer', ts: '2026-06-09T08:02:00.000Z' }),
        ].join('\n') + '\n',
      );

      const catalog = createSessionCatalog({ dir });

      expect(catalog.listSessions()).toEqual([
        expect.objectContaining({
          id: 'log-only',
          eventCount: 3,
          firstPrompt: 'Recovered prompt from log',
          lastActivity: '2026-06-09T08:02:00.000Z',
        }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('repairs stale sidecar context and sorts by the real latest log event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-events-stale-meta-'));
    try {
      await writeSession(dir, {
        id: 'stale-new',
        cwd: '/work/new',
        startedAt: '2026-06-09T07:00:00.000Z',
        lastActivity: '2026-06-09T07:00:00.000Z',
        eventCount: 0,
        firstPrompt: null,
      }, [
        { type: 'user_prompt', text: 'Latest real session', ts: '2026-06-09T09:00:00.000Z' },
        { type: 'assistant_message', content: 'ok', ts: '2026-06-09T09:02:00.000Z' },
      ]);
      await writeSession(dir, {
        id: 'sidecar-old',
        cwd: '/work/old',
        startedAt: '2026-06-09T08:00:00.000Z',
        lastActivity: '2026-06-09T08:30:00.000Z',
        eventCount: 1,
        firstPrompt: 'Older sidecar session',
      }, [
        { type: 'user_prompt', text: 'Older sidecar session', ts: '2026-06-09T08:30:00.000Z' },
      ]);

      const catalog = createSessionCatalog({ dir });

      expect(catalog.listSessions().map((session: { readonly id: string }) => session.id)).toEqual(['stale-new', 'sidecar-old']);
      expect(catalog.listSessions()[0]).toMatchObject({
        eventCount: 2,
        firstPrompt: 'Latest real session',
        lastActivity: '2026-06-09T09:02:00.000Z',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeSession(
  dir: string,
  meta: {
    readonly id: string;
    readonly cwd: string;
    readonly startedAt: string;
    readonly lastActivity: string;
    readonly eventCount: number;
    readonly firstPrompt?: string | null;
    readonly provider?: string | null;
    readonly model?: string | null;
  },
  events: ReadonlyArray<Record<string, unknown> | string> = [],
) {
  await writeFile(join(dir, `${meta.id}.meta.json`), JSON.stringify(meta, null, 2));
  await writeFile(
    join(dir, `${meta.id}.jsonl`),
    events.map((event) => (typeof event === 'string' ? event : JSON.stringify(event))).join('\n') + '\n',
  );
}
