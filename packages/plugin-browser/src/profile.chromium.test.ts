import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { chromiumAvailable } from './page/chromium-tab.test-support.js';
import { claimProfile, ProfileBusyError, signedInSites, signIn, signOut, type BrowserProfile } from './profile.js';
import { dispatch, teardown, type SidecarState } from './sidecar/dispatch.js';

/**
 * The terminal's browser keeps what a person signs in to, as the desktop's
 * pane does: one profile on disk, one Chromium on it at a time, and a way to
 * sign in to a site and to forget it. Skipped where no Chromium is installed.
 */

const available = await chromiumAvailable();

function newProfile(): BrowserProfile {
  const root = mkdtempSync(join(tmpdir(), 'moxxy-profile-'));
  return { dir: join(root, 'profile'), lock: join(root, 'profile.lock') };
}

const inAnHour = (): number => Math.floor(Date.now() / 1000) + 3600;
const cookie = (name: string, domain: string) => ({ name, value: '1', domain, path: '/', expires: inAnHour() });

/** Put cookies in a profile the way a sign-in leaves them. */
async function seed(profile: BrowserProfile, cookies: ReturnType<typeof cookie>[]): Promise<void> {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profile.dir, { headless: true });
  await context.addCookies(cookies);
  await context.close();
}

async function cookiesIn(profile: BrowserProfile): Promise<string[]> {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profile.dir, { headless: true });
  const names = (await context.cookies()).map((c) => `${c.name}@${c.domain}`).sort();
  await context.close();
  return names;
}

describe('claimProfile', () => {
  it('lets one holder have the profile at a time and frees it on release', () => {
    const profile = newProfile();
    const release = claimProfile(profile);
    expect(typeof release).toBe('function');
    expect(claimProfile(profile)).toEqual({ busy: process.pid });
    if (typeof release === 'function') release();
    const again = claimProfile(profile);
    expect(typeof again).toBe('function');
    if (typeof again === 'function') again();
  });

  it('takes over a lock its holder left behind when it died', () => {
    const profile = newProfile();
    claimProfile(profile);
    writeFileSync(profile.lock, '999999999');
    const release = claimProfile(profile);
    expect(typeof release).toBe('function');
    if (typeof release === 'function') release();
  });
});

describe.skipIf(!available)('the terminal browser profile', () => {
  let state: SidecarState | null = null;
  // Each test's browser is its own (a profile cannot be shared), and closing
  // one under a full parallel `pnpm test` can take longer than the default.
  afterEach(async () => {
    if (state) await teardown(state);
    state = null;
  }, 30_000);

  async function sidecar(profile: BrowserProfile): Promise<SidecarState> {
    const current: SidecarState = { handle: null, pendingInstallNotice: null, profile };
    state = current;
    const reply = await dispatch(current, { id: '1', method: 'init', params: {} });
    if (!reply.ok) throw new Error(reply.error.message);
    return current;
  }

  it('keeps a sign-in from one run of the sidecar to the next', async () => {
    const profile = newProfile();
    const first = await sidecar(profile);
    const context = first.handle?.context as unknown as { addCookies(c: unknown[]): Promise<void> };
    await context.addCookies([cookie('session', '.example.com')]);
    await teardown(first);

    const second = await sidecar(profile);
    const reopened = second.handle?.context as unknown as { cookies(): Promise<Array<{ name: string }>> };
    expect((await reopened.cookies()).map((c) => c.name)).toEqual(['session']);
  });

  it('holds the profile while it runs, and lets go when it closes', async () => {
    const profile = newProfile();
    const running = await sidecar(profile);
    expect(claimProfile(profile)).toEqual({ busy: process.pid });
    await teardown(running);
    const release = claimProfile(profile);
    expect(typeof release).toBe('function');
    if (typeof release === 'function') release();
  });

  it('starts signed out, and says so, when another run holds the profile', async () => {
    const profile = newProfile();
    await seed(profile, [cookie('session', '.example.com')]);
    const release = claimProfile(profile);
    try {
      const running = await sidecar(profile);
      expect(running.pendingInstallNotice).toMatch(/signed out/);
      const context = running.handle?.context as unknown as { cookies(): Promise<unknown[]> };
      expect(await context.cookies()).toEqual([]);
    } finally {
      if (typeof release === 'function') release();
    }
  });

  it('forgets one site — its subdomains too — and keeps the others', async () => {
    const profile = newProfile();
    await seed(profile, [cookie('a', '.example.com'), cookie('b', 'accounts.example.com'), cookie('c', '.other.org')]);
    expect(await signOut(profile, 'example.com')).toEqual({ forgot: ['accounts.example.com', 'example.com'] });
    expect(await cookiesIn(profile)).toEqual(['c@.other.org']);
  });

  it('forgets every sign-in at once', async () => {
    const profile = newProfile();
    await seed(profile, [cookie('a', '.example.com')]);
    await signOut(profile);
    expect(existsSync(profile.dir)).toBe(false);
  });

  it('lists the sites it is signed in to', async () => {
    const profile = newProfile();
    expect(await signedInSites(profile)).toEqual([]);
    await seed(profile, [cookie('a', '.example.com'), cookie('b', 'www.example.com'), cookie('c', 'accounts.other.org')]);
    expect(await signedInSites(profile)).toEqual(['accounts.other.org', 'example.com']);
  });

  it('opens a window on the site and keeps what was signed in once it is closed', async () => {
    const profile = newProfile();
    let opened = '';
    await signIn(profile, 'example.com', {
      headless: true,
      // Before the window goes to the site: answer it here, and close it once
      // it shows, as the person does once they have signed in.
      onOpen: async (window) => {
        const context = window as unknown as BrowserContext;
        await context.route('https://example.com/**', (route) =>
          route.fulfill({ body: '<title>Zaloguj</title>', contentType: 'text/html' }),
        );
        const page = context.pages()[0];
        page?.once('load', () => {
          opened = page.url();
          void context.addCookies([cookie('session', '.example.com')]).then(() => page.close());
        });
      },
    });
    expect(opened).toMatch(/^https:\/\/example\.com/);
    expect(await cookiesIn(profile)).toEqual(['session@.example.com']);
  });

  it('refuses to sign in or out while a run holds the profile', async () => {
    const profile = newProfile();
    const release = claimProfile(profile);
    try {
      await expect(signIn(profile, 'example.com', { headless: true })).rejects.toBeInstanceOf(ProfileBusyError);
      await expect(signOut(profile, 'example.com')).rejects.toThrow(/in use by another moxxy run/);
      await expect(signedInSites(profile)).rejects.toBeInstanceOf(ProfileBusyError);
    } finally {
      if (typeof release === 'function') release();
    }
  });
});
