import { existsSync, rmSync } from 'node:fs';
import { claimProfile, ProfileBusyError, type BrowserProfile } from './profile-lock.js';
import { siteOf } from './site-access.js';
import { importPlaywright } from './sidecar/install.js';

/**
 * The terminal's browser profile: what the headless browser keeps between
 * runs — cookies, a site's stored sign-in — as the desktop's pane keeps its
 * own. Signing in happens in a window the person uses (`signIn`); the agent's
 * headless browser then starts signed in.
 */

export { claimProfile, defaultBrowserProfile, ProfileBusyError, type BrowserProfile } from './profile-lock.js';

/** The slice of a Playwright persistent context the profile commands use. */
export interface ProfileContext {
  pages(): ReadonlyArray<ProfilePage>;
  newPage(): Promise<ProfilePage>;
  cookies(): Promise<ReadonlyArray<{ domain: string }>>;
  clearCookies(filter?: { domain?: string }): Promise<void>;
  newCDPSession(page: ProfilePage): Promise<{ send(method: string, params?: Record<string, unknown>): Promise<unknown> }>;
  close(): Promise<void>;
}

interface ProfilePage {
  goto(url: string, opts?: unknown): Promise<unknown>;
  on(event: 'close', fn: () => void): unknown;
}

interface PersistentLauncher {
  launchPersistentContext(dir: string, opts: Record<string, unknown>): Promise<ProfileContext>;
}

/** Run `use` on the profile, opened in a browser of its own, holding the profile throughout. */
async function withProfile<T>(
  profile: BrowserProfile,
  opts: Record<string, unknown>,
  use: (context: ProfileContext) => Promise<T>,
): Promise<T> {
  const claim = claimProfile(profile);
  if (typeof claim !== 'function') throw new ProfileBusyError(claim.busy);
  try {
    const { chromium } = (await importPlaywright()) as unknown as { chromium: PersistentLauncher };
    const context = await chromium.launchPersistentContext(profile.dir, opts);
    try {
      return await use(context);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    claim();
  }
}

/** The page to open for `input` — a site or a whole URL — or why it is not one. */
function signInUrl(input: string): string {
  const site = siteOf(input);
  if (!site) throw new Error(`${JSON.stringify(input)} is not a website`);
  return /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
}

/** A person left a sign-in window open and walked away; keep what it holds. */
const SIGN_IN_LIMIT_MS = 15 * 60_000;

export interface SignInOptions {
  /** For tests: a window nobody sees. */
  readonly headless?: boolean;
  /** Called with the window's context before it goes to the site. */
  readonly onOpen?: (context: ProfileContext) => Promise<void> | void;
}

/**
 * Open a window on `site` for the person to sign in, and wait until they close
 * it. Whatever the site stored then stays in the profile for the agent.
 */
export async function signIn(profile: BrowserProfile, site: string, opts: SignInOptions = {}): Promise<void> {
  const url = signInUrl(site);
  await withProfile(
    profile,
    {
      headless: opts.headless ?? false,
      viewport: null,
      // Sites refuse a sign-in in a browser that announces it is automated.
      ignoreDefaultArgs: ['--enable-automation'],
    },
    async (context) => {
      const page = context.pages()[0] ?? (await context.newPage());
      const closed = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SIGN_IN_LIMIT_MS);
        timer.unref?.();
        const watch = (tab: ProfilePage): void => {
          tab.on('close', () => {
            if (context.pages().length === 0) {
              clearTimeout(timer);
              resolve();
            }
          });
        };
        for (const tab of context.pages()) watch(tab);
        (context as unknown as { on(event: 'page', fn: (tab: ProfilePage) => void): void }).on('page', watch);
      });
      await opts.onOpen?.(context);
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await closed;
    },
  );
}

const hostOf = (domain: string): string => domain.replace(/^\./, '').toLowerCase();
const within = (host: string, site: string): boolean => host === site || host.endsWith(`.${site}`);

/**
 * Forget a sign-in: the cookies and stored data of `site` and its subdomains,
 * or — with no site — the whole profile. Returns the hosts it forgot.
 */
export async function signOut(profile: BrowserProfile, site?: string): Promise<{ forgot: string[] }> {
  if (site === undefined) {
    const claim = claimProfile(profile);
    if (typeof claim !== 'function') throw new ProfileBusyError(claim.busy);
    try {
      rmSync(profile.dir, { recursive: true, force: true });
    } finally {
      claim();
    }
    return { forgot: [] };
  }
  const wanted = siteOf(site);
  if (!wanted) throw new Error(`${JSON.stringify(site)} is not a website`);
  return withProfile(profile, { headless: true }, async (context) => {
    const domains = [...new Set((await context.cookies()).map((c) => c.domain))].filter((d) => within(hostOf(d), wanted));
    for (const domain of domains) await context.clearCookies({ domain });
    const hosts = [...new Set(domains.map(hostOf))].sort();
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    for (const host of new Set([...hosts, wanted, `www.${wanted}`])) {
      await cdp.send('Storage.clearDataForOrigin', { origin: `https://${host}`, storageTypes: 'all' }).catch(() => {});
    }
    return { forgot: hosts };
  });
}

/** The sites the profile holds a sign-in for (any cookie), as `siteOf` names them. */
export async function signedInSites(profile: BrowserProfile): Promise<string[]> {
  const claim = claimProfile(profile);
  if (typeof claim !== 'function') throw new ProfileBusyError(claim.busy);
  claim();
  if (!existsSync(profile.dir)) return [];
  return withProfile(profile, { headless: true }, async (context) => {
    const sites = (await context.cookies()).map((c) => siteOf(hostOf(c.domain))).filter((s): s is string => !!s);
    return [...new Set(sites)].sort();
  });
}
