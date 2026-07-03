import { describe, expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { MoxxyError } from '@moxxy/sdk';
import { buildCategoryDefaultLive } from './builtins.js';

describe('buildCategoryDefaultLive — missing-contribution errors', () => {
  it('throws typed PLUGIN_NOT_INSTALLED when the catalog provides the contribution', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const live = buildCategoryDefaultLive(session);
    // Fresh session registers no modes; 'goal' is provided by @moxxy/mode-goal
    // in the installable catalog.
    const err = await live.setCategoryDefault('mode', 'goal').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('PLUGIN_NOT_INSTALLED');
    expect((err as MoxxyError).context).toMatchObject({
      category: 'mode',
      contribution: 'goal',
      package: '@moxxy/mode-goal',
    });
  });

  it('keeps the generic TOOL_ERROR for contributions the catalog does not know', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const live = buildCategoryDefaultLive(session);
    const err = await live.setCategoryDefault('mode', 'no-such-mode').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('TOOL_ERROR');
  });
});
