import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WorkspaceRegistry } from '@moxxy/workspace-registry';
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '@moxxy/core';

import type { ParsedArgv } from '../argv';
import { resolveId, runSessionsCommand } from './sessions.js';

function meta(id: string): SessionMeta {
  return {
    id,
    cwd: '/tmp',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastActivity: '2026-01-01T00:00:00.000Z',
    eventCount: 0,
    firstPrompt: null,
    provider: null,
    model: null,
  };
}

const all = [meta('aaaa-1111'), meta('aaaa-2222'), meta('bbbb-3333')];

describe('resolveId', () => {
  it('resolves a 1-based numeric index into the list', () => {
    expect(resolveId('1', all)).toBe('aaaa-1111');
    expect(resolveId('3', all)).toBe('bbbb-3333');
  });

  it('returns the raw input for an out-of-range index (no match)', () => {
    expect(resolveId('9', all)).toBe('9');
    expect(resolveId('0', all)).toBe('0');
  });

  it('matches an exact id', () => {
    expect(resolveId('aaaa-2222', all)).toBe('aaaa-2222');
  });

  it('resolves a unique suffix', () => {
    expect(resolveId('3333', all)).toBe('bbbb-3333');
  });

  it('resolves a unique prefix', () => {
    expect(resolveId('bbbb', all)).toBe('bbbb-3333');
  });

  it('returns the raw input on an ambiguous suffix/prefix (caller surfaces not-found)', () => {
    // "aaaa" prefixes two entries → ambiguous → echo input back.
    expect(resolveId('aaaa', all)).toBe('aaaa');
  });

  it('returns the raw input when nothing matches', () => {
    expect(resolveId('zzz', all)).toBe('zzz');
  });

  it('trims surrounding whitespace before resolving', () => {
    expect(resolveId('  aaaa-1111  ', all)).toBe('aaaa-1111');
    expect(resolveId(' 2 ', all)).toBe('aaaa-2222');
  });
});

describe('moxxy sessions delete', () => {
  it('removes the deleted session from the shared workspace registry', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'moxxy-sessions-delete-'));
    const oldHome = process.env.HOME;
    const oldMoxxyHome = process.env.MOXXY_HOME;
    process.env.HOME = root;
    process.env.MOXXY_HOME = path.join(root, '.moxxy');
    try {
      const sessionId = 'session-delete';
      const cwd = path.join(root, 'project');
      mkdirSync(cwd, { recursive: true });
      const sessionsDir = path.join(root, '.moxxy', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      // The single per-session file (`<id>.json`) + its event log are the only
      // record of a session; the registry derives the list from them.
      writeFileSync(path.join(sessionsDir, `${sessionId}.jsonl`), '{"type":"noop"}\n');
      writeFileSync(
        path.join(sessionsDir, `${sessionId}.json`),
        JSON.stringify({
          version: 1,
          id: sessionId,
          cwd,
          startedAt: '2026-06-12T10:00:00.000Z',
          lastActivity: '2026-06-12T10:05:00.000Z',
          eventCount: 1,
          firstPrompt: 'delete me',
          provider: null,
          model: null,
          source: 'tui',
        }),
      );
      const registry = new WorkspaceRegistry();
      // Sanity: the session is derivable before deletion.
      expect(await registry.deskForSession(sessionId)).not.toBeNull();

      await runSessionsCommand({
        command: 'sessions',
        flags: {},
        positional: ['delete', sessionId],
      } satisfies ParsedArgv);

      expect(await registry.deskForSession(sessionId)).toBeNull();
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldMoxxyHome === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = oldMoxxyHome;
    }
  });
});
