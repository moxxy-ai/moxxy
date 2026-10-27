import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordProviderMigrationNotice } from '@moxxy/config';
import { assertDefined } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { setActiveBus } from './shared';
import { registerOnboardingHandlers } from './onboarding';

type Handler = (...args: unknown[]) => Promise<unknown>;

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as never);
  registerOnboardingHandlers({ active: () => undefined } as never);
  return handlers;
}

describe('onboarding.providerAuthKind before a runner is reachable', () => {
  it.each(['claude-code', 'codex-agent', 'opencode'])('signs in to %s rather than asking for a key', async (provider) => {
    const authKind = captureHandlers().get('onboarding.providerAuthKind');
    assertDefined(authKind, 'onboarding.providerAuthKind handler');
    expect(await authKind({ provider })).toBe('oauth');
  });

  it.each(['anthropic', 'openai'])('asks for an API key for %s', async (provider) => {
    const authKind = captureHandlers().get('onboarding.providerAuthKind');
    assertDefined(authKind, 'onboarding.providerAuthKind handler');
    expect(await authKind({ provider })).toBe('api-key');
  });
});

describe('the one-time notice that the ChatGPT sign-in moved to the Codex agent', () => {
  it('reports the saved move in onboarding.status until it is dismissed', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'moxxy-migration-ipc-'));
    const previous = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    try {
      const handlers = captureHandlers();
      const status = handlers.get('onboarding.status');
      const dismiss = handlers.get('onboarding.dismissProviderMigration');
      assertDefined(status, 'onboarding.status handler');
      assertDefined(dismiss, 'onboarding.dismissProviderMigration handler');

      expect(await status()).toMatchObject({ providerMigration: null });
      await recordProviderMigrationNotice({ from: 'openai-codex', to: 'codex-agent' });
      expect(await status()).toMatchObject({ providerMigration: { from: 'openai-codex', to: 'codex-agent' } });

      await dismiss();
      expect(await status()).toMatchObject({ providerMigration: null });
    } finally {
      if (previous === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = previous;
      await removeDir(home);
    }
  });
});
