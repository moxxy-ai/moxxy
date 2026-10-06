import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { setActiveBus } from './shared';
import { registerSettingsHandlers } from './settings';
import { removeDir } from '@moxxy/vitest-preset/fs';

type Handler = (...args: unknown[]) => Promise<unknown>;

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as never);
  registerSettingsHandlers({} as never);
  return handlers;
}

describe('settings.providerCatalog', () => {
  const previousHome = process.env.MOXXY_HOME;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'moxxy-settings-'));
    process.env.MOXXY_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previousHome;
    await removeDir(home);
  });

  it('offers every provider the desktop ships, including the Claude Pro/Max sign-in', async () => {
    const catalog = captureHandlers().get('settings.providerCatalog');
    assertDefined(catalog, 'settings.providerCatalog handler');

    expect(await catalog()).toEqual(['anthropic', 'openai', 'openai-codex', 'claude-code']);
  });
});
