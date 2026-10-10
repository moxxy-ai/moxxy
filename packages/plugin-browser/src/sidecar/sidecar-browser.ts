import { dispatchToHost } from '../page/dispatch.js';
import { BrowserHost, type HostReply } from '../page/host.js';
import { playwrightContents, type PlaywrightCdp, type PlaywrightContents, type PlaywrightPage } from './playwright-contents.js';

/** What the sidecar's Playwright context offers for its tabs. */
export interface TabContext {
  newPage(): Promise<unknown>;
  newCDPSession?(page: never): Promise<unknown>;
}

/** Why a hand-off cannot happen here, said so the agent tells the user rather than waits. */
export const NO_WINDOW =
  'This browser has no window anyone can use — it runs headless, outside the desktop — so nobody can sign in, ' +
  'solve a check or accept anything in it. Stop acting on this page and tell the user what it needs; they can ' +
  'finish it in the Moxxy desktop app or in their own browser.';

/**
 * The agent's tabs in the headless sidecar, driven by the same `BrowserHost`
 * as the desktop's pane.
 *
 * The first page is the agent's from the start, so a tab the site opens later
 * — a popup, a `target=_blank` link — becomes a tab the agent can address and
 * is reported by the press that opened it, without retargeting a command that
 * names no tab.
 */
export class SidecarBrowser {
  readonly host: BrowserHost;
  private readonly contents = new Map<number, PlaywrightContents>();
  private readonly pages = new Map<string, PlaywrightPage>();
  private seq = 0;

  private constructor(private readonly context: TabContext) {
    this.host = new BrowserHost((id) => this.contents.get(id) ?? null);
    this.host.setOpener((request) => void this.open(request));
  }

  static async start(context: TabContext, first: unknown): Promise<SidecarBrowser> {
    if (typeof context.newCDPSession !== 'function') {
      throw new Error('this browser does not expose CDP (accessibility perception needs chromium)');
    }
    const browser = new SidecarBrowser(context);
    browser.host.noteAgentTab(await browser.adopt(first as PlaywrightPage));
    return browser;
  }

  async call(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<HostReply> {
    if (method === 'await_human') return { ok: false, error: { message: NO_WINDOW } };
    await Promise.all([...this.contents.values()].map((wc) => wc.refreshTitle()));
    return dispatchToHost(this.host, method, params, { closeTab: (tabId) => this.close(tabId), ...(signal ? { signal } : {}) });
  }

  private async adopt(page: PlaywrightPage, requestId?: string): Promise<string> {
    const open = this.context.newCDPSession as (page: unknown) => Promise<unknown>;
    const cdp = (await open.call(this.context, page)) as PlaywrightCdp;
    const wc = playwrightContents(++this.seq, page, cdp);
    await wc.refreshTitle();
    this.contents.set(wc.id, wc);
    const tabId = this.host.register(wc.id, requestId);
    this.pages.set(tabId, page);
    page.on('popup', ((popup: PlaywrightPage) => {
      this.host.noteOpened(
        wc.id,
        this.adopt(popup).then(
          (opened) => ({ tabId: opened, url: popup.url() }),
          () => null,
        ),
      );
    }) as never);
    page.on('close', (() => {
      this.host.unregister(tabId);
      this.contents.delete(wc.id);
      this.pages.delete(tabId);
    }) as never);
    return tabId;
  }

  /** A tab the agent asked for: on its page before it is one, as a tab the pane opens arrives loading. */
  private async open(request: { requestId: string; url: string }): Promise<void> {
    const page = (await this.context.newPage()) as PlaywrightPage;
    if (request.url !== 'about:blank') {
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => {});
    }
    await this.adopt(page, request.requestId);
  }

  private async close(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (page) await page.close();
    else this.host.unregister(tabId);
  }
}
