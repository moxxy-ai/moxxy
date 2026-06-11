import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ModeContext, ModeDef, MoxxyEvent, ProviderDef, SessionLike } from '@moxxy/sdk';
import { defineMode, defineProvider, definePlugin, defineTool } from '@moxxy/sdk';
import { Session, collectTurn } from '@moxxy/core';

import { isLocalSession, spawnWorkerSession } from './worker-session.js';

function makeMarkerLoop(name: string): ModeDef {
  return defineMode({
    name,
    run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
      await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'assistant',
        text: `done:${ctx.turnId}`,
      });
    },
  });
}

function makeNoopProvider(): ProviderDef {
  const models = [{ id: 'noop-1' }];
  return defineProvider({
    name: 'noop',
    models,
    createClient: () => ({
      name: 'noop',
      models,
      stream: async function* () {
        // unused — the marker loop doesn't call into the provider.
      },
      countTokens: async () => 0,
    }),
  });
}

function buildPrimary(): Session {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'test-fixture',
      version: '0.0.0',
      providers: [makeNoopProvider()],
      modes: [makeMarkerLoop('marker'), makeMarkerLoop('other')],
      tools: [
        defineTool({
          name: 'wave',
          description: 'waves at the office',
          inputSchema: z.object({}),
          handler: async () => '👋',
        }),
      ],
    }),
  );
  session.providers.setActive('noop');
  session.modes.setActive('other');
  return session;
}

describe('isLocalSession', () => {
  it('accepts a core Session and rejects a registry-less SessionLike', () => {
    const primary = buildPrimary();
    expect(isLocalSession(primary)).toBe(true);
    const remoteish = { id: 'x', cwd: '/tmp', log: { subscribe: () => () => {} } };
    expect(isLocalSession(remoteish as unknown as SessionLike)).toBe(false);
  });
});

describe('spawnWorkerSession', () => {
  it('shares the credentialed active provider instance with the primary', () => {
    const primary = buildPrimary();
    const worker = spawnWorkerSession(primary, { cwd: '/tmp' });
    expect(worker.providers.getActiveName()).toBe('noop');
    expect(worker.providers.getActive()).toBe(primary.providers.getActive());
  });

  it('copies modes/tools/commands and preserves the active mode', () => {
    const primary = buildPrimary();
    const worker = spawnWorkerSession(primary, { cwd: '/tmp' });
    expect(worker.modes.getActive().name).toBe('other');
    expect(worker.modes.list().map((m) => m.name).sort()).toEqual(['marker', 'other']);
    expect(worker.tools.get('wave')).toBeDefined();
  });

  it('survives constructor-seeded registries (view renderer, localhost tunnel)', () => {
    const primary = buildPrimary();
    // Both sessions seed the same defaults — the copy must skip, not throw.
    const worker = spawnWorkerSession(primary, { cwd: '/tmp' });
    expect(worker.viewRenderers.list().length).toBeGreaterThan(0);
  });

  it('shares the permission engine so allow-rules apply office-wide', () => {
    const primary = buildPrimary();
    const worker = spawnWorkerSession(primary, { cwd: '/tmp' });
    expect(worker.permissions).toBe(primary.permissions);
  });

  it('gives the worker its own id and isolated event log', async () => {
    const primary = buildPrimary();
    const worker = spawnWorkerSession(primary, { cwd: '/tmp' });
    expect(worker.id).not.toBe(primary.id);

    const events = await collectTurn(worker, 'hello office');
    expect(events.some((e) => e.type === 'assistant_message')).toBe(true);
    // Worker turn activity lands only in the worker's log.
    expect(worker.log.length).toBeGreaterThan(0);
    expect(primary.log.length).toBe(0);
  });
});
