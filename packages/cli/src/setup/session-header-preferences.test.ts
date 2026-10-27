import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readSessionIndex, Session, silentLogger } from '@moxxy/core';
import { definePlugin, defineProvider } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

import { applySessionHeaderPreferences } from './session-header-preferences';

describe('applySessionHeaderPreferences', () => {
  it('restores sticky session provider and model over the currently active provider', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-session-header-'));
    const moxxyHome = path.join(home, '.moxxy');
    const originalMoxxyHome = process.env.MOXXY_HOME;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.MOXXY_HOME = moxxyHome;
    try {
      const sessionId = '01SESSIONHEADER0000000000';
      const sessionsDir = path.join(moxxyHome, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        path.join(sessionsDir, `${sessionId}.meta.json`),
        JSON.stringify({
          id: sessionId,
          cwd: '/tmp/project',
          startedAt: '2026-06-16T00:00:00.000Z',
          lastActivity: '2026-06-16T00:00:01.000Z',
          eventCount: 1,
          firstPrompt: 'hello',
          provider: 'session-provider',
          model: 'session-model',
        }, null, 2) + '\n',
        'utf8',
      );
      writeFileSync(path.join(sessionsDir, `${sessionId}.jsonl`), '', 'utf8');
      const session = new Session({ cwd: '/tmp/project', logger: silentLogger });
      session.pluginHost.registerStatic(
        definePlugin({
          name: '@test/session-header-providers',
          version: '0.0.0',
          providers: [
            providerDef('global-provider', ['global-model']),
            providerDef('session-provider', ['session-model']),
          ],
        }),
      );
      session.providers.setActive('global-provider');

      await expect(readSessionIndex()).resolves.toEqual([
        expect.objectContaining({
          id: sessionId,
          provider: 'session-provider',
          model: 'session-model',
        }),
      ]);

      await applySessionHeaderPreferences(
        session,
        sessionId,
        async (providerName) => ({ restoredProvider: providerName }),
        silentLogger,
      );

      expect(session.providers.getActiveName()).toBe('session-provider');
      expect(session.lastResolvedModel).toBe('session-model');
    } finally {
      if (originalMoxxyHome === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = originalMoxxyHome;
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
    }
  });
});

describe('applySessionHeaderPreferences in a conversation nothing happened in', () => {
  it('keeps the active provider but takes no model as the one the conversation last ran on', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-session-header-'));
    const moxxyHome = path.join(home, '.moxxy');
    const originalMoxxyHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = moxxyHome;
    try {
      const sessionId = '01SESSIONHEADEREMPTY000000';
      const sessionsDir = path.join(moxxyHome, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      // An older runner wrote the first model its provider lists into a conversation that had not started.
      writeFileSync(
        path.join(sessionsDir, `${sessionId}.meta.json`),
        JSON.stringify({
          id: sessionId,
          cwd: '/tmp/project',
          startedAt: '2026-06-16T00:00:00.000Z',
          lastActivity: '2026-06-16T00:00:00.000Z',
          eventCount: 0,
          firstPrompt: null,
          provider: 'session-provider',
          model: 'big-model',
        }, null, 2) + '\n',
        'utf8',
      );
      writeFileSync(path.join(sessionsDir, `${sessionId}.jsonl`), '', 'utf8');
      const session = new Session({ cwd: '/tmp/project', logger: silentLogger });
      session.pluginHost.registerStatic(
        definePlugin({
          name: '@test/session-header-providers',
          version: '0.0.0',
          providers: [providerDef('session-provider', ['big-model', 'light-model'])],
        }),
      );

      await applySessionHeaderPreferences(session, sessionId, async () => ({}), silentLogger);

      expect(session.providers.getActiveName()).toBe('session-provider');
      expect(session.lastResolvedModel).toBeNull();
    } finally {
      if (originalMoxxyHome === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = originalMoxxyHome;
    }
  });
});

function providerDef(name: string, modelIds: string[]) {
  const models = modelIds.map((id) => ({ id }));
  return defineProvider({
    name,
    models,
    createClient: () => ({
      name,
      models,
      stream: async function* () {},
      countTokens: async () => 0,
    }),
  });
}


it('reopens a retired ChatGPT conversation on Codex without reusing its private model id', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-retired-session-'));
  const previous = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  const session = new Session({ cwd: home, logger: silentLogger });
  try {
    mkdirSync(path.join(home, 'sessions'));
    const id = '01RETIREDSESSION000000000';
    writeFileSync(path.join(home, 'sessions', `${id}.meta.json`), JSON.stringify({ id, cwd: home, startedAt: '2026-10-20T00:00:00Z', lastActivity: '2026-10-20T00:00:00Z', eventCount: 5, provider: 'openai-codex', model: 'gpt-old-codex' }));
    writeFileSync(path.join(home, 'sessions', `${id}.jsonl`), '');
    session.pluginHost.registerStatic(definePlugin({ name: '@test/migration', providers: [providerDef('codex-agent', ['gpt-6-sol']), providerDef('other', ['other'])] }));
    session.providers.setActive('other');
    const warnings: string[] = [];
    await applySessionHeaderPreferences(session, id, async () => ({}), { warn: message => { warnings.push(message); } });
    expect(session.providers.getActiveName()).toBe('codex-agent');
    expect(session.lastResolvedProvider).not.toBe('openai-codex');
    expect(session.lastResolvedModel).not.toBe('gpt-old-codex');
    expect(warnings.join(' ')).toMatch(/ChatGPT sign-in was removed/);
  } finally {
    await session.close();
    if (previous === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previous;
    removeDirSync(home);
  }
});
