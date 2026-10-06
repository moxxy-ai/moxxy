import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { CommandOutput } from '@moxxy/sdk';
import { buildBrowserCommand } from './browser-command.js';
import { chromiumAvailable } from './page/chromium-tab.test-support.js';
import { claimProfile, type BrowserProfile } from './profile.js';

/**
 * `/browser` — and `moxxy browser`, which runs it — signs the terminal's
 * browser in to a site, forgets it, and lists what it is signed in to.
 * Skipped where no Chromium is installed.
 */

const available = await chromiumAvailable();

function newProfile(): BrowserProfile {
  const root = mkdtempSync(join(tmpdir(), 'moxxy-command-'));
  return { dir: join(root, 'profile'), lock: join(root, 'profile.lock') };
}

const run = (profile: BrowserProfile, args: string, closeOwn = async () => {}): Promise<CommandOutput> =>
  Promise.resolve(
    buildBrowserCommand({
      profile: () => profile,
      closeOwnBrowser: closeOwn,
      signInOptions: {
        headless: true,
        onOpen: async (window) => {
          const context = window as unknown as BrowserContext;
          await context.route('https://**/*', (route) => route.fulfill({ body: '<title>Zaloguj</title>', contentType: 'text/html' }));
          const page = context.pages()[0];
          page?.once('load', () => void page.close());
        },
      },
    }).handler({ channel: 'tui', sessionId: 's' as never, args, session: {} }),
  );

const textOf = (output: CommandOutput): string => {
  if (output.kind === 'text') return output.text;
  if (output.kind === 'error') return `error: ${output.message}`;
  return output.kind;
};

describe('/browser', () => {
  it('says how to use it when given nothing it knows', async () => {
    const profile = newProfile();
    expect(textOf(await run(profile, ''))).toMatch(/login <site>[\s\S]*logout <site>[\s\S]*logout --all[\s\S]*sites/);
    expect(textOf(await run(profile, 'dance'))).toMatch(/^error: unknown action "dance"/);
    expect(textOf(await run(profile, 'login'))).toMatch(/^error: name the site/);
    expect(textOf(await run(profile, 'logout'))).toMatch(/^error: name the site.*--all/);
  });

  it('refuses a site that is not one', async () => {
    expect(textOf(await run(newProfile(), 'login file:///etc/passwd'))).toMatch(/^error: .*not a website/);
  });

  describe.skipIf(!available)('on a real profile', () => {
    it('signs in to a site, lists it, and forgets it', async () => {
      const profile = newProfile();
      let closed = 0;
      const signedIn = textOf(await run(profile, 'login example.com', async () => void closed++));
      expect(signedIn).toMatch(/example\.com/);
      expect(closed).toBe(1);

      expect(textOf(await run(profile, 'sites'))).toMatch(/no saved sign-ins|example\.com/);
      expect(textOf(await run(profile, 'logout example.com'))).toMatch(/example\.com/);
      expect(textOf(await run(profile, 'logout --all'))).toMatch(/every sign-in/);
      expect(textOf(await run(profile, 'sites'))).toMatch(/no saved sign-ins/);
    });

    it('says who holds the profile when it is in use', async () => {
      const profile = newProfile();
      const release = claimProfile(profile);
      try {
        expect(textOf(await run(profile, 'login example.com'))).toMatch(/^error: .*in use by another moxxy run/);
      } finally {
        if (typeof release === 'function') release();
      }
    });
  });
});
