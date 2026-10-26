import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { readPrefs } from '../prefs';
import { registerPrefsHandlers } from './prefs';
import { setActiveBus } from './shared';

describe('preferences in a Node host', () => {
  it('persists a theme without initializing the Electron binary package', async () => {
    const require = createRequire(import.meta.url);
    const electronEntry = require.resolve('electron');
    expect(process.versions.electron).toBeUndefined();
    expect(require.cache[electronEntry]).toBeUndefined();

    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    setActiveBus({
      handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      },
    } as never);
    registerPrefsHandlers();
    const update = handlers.get('prefs.update');
    assertDefined(update, 'prefs.update handler');

    expect(await update({ theme: 'dark' })).toMatchObject({ theme: 'dark' });
    expect(readPrefs().theme).toBe('dark');
    expect(require.cache[electronEntry]).toBeUndefined();
  });
});
