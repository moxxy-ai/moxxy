import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readSessionIndex, Session, silentLogger } from '@moxxy/core';
import { definePlugin, defineProvider } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';

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
