/**
 * JSON-RPC dispatch table for the sidecar. Each `method` here corresponds
 * one-to-one with the wire-format methods documented in `sidecar.ts`.
 */

import { randomUUID } from 'node:crypto';

import { assertPublicUrl } from '../ssrf-guard.js';
import { importPlaywright, launchWithAutoInstall } from './install.js';
import {
  badParams,
  errMsg,
  SidecarError,
  type BrowserKind,
  type PlaywrightHandle,
  type PageHandle,
  type Reply,
  type Req,
} from './types.js';

/**
 * Ceiling on screenshot/capture waits inside the sidecar so a page whose render
 * is wedged fails the op cleanly instead of blocking the serial request queue
 * indefinitely (the parent has its own per-call timeout as a backstop, but
 * bounding it here drains the queue head sooner). Generous enough for a slow
 * full-page screenshot; well under the parent ceiling.
 */
const SCREENSHOT_TIMEOUT_MS = 30_000;
/** Hard ceiling on viewport / screenshot-clip dimensions, matching Chromium's
 *  max texture/screenshot size — bounds allocation from a malformed surface
 *  message (e.g. width:1e9). */
const MAX_DIMENSION = 16_384;

interface PlaywrightTabRegistry {
  activeTabId: string;
  readonly pages: Map<string, PageHandle>;
}

const tabRegistries = new WeakMap<SidecarState, PlaywrightTabRegistry>();

export interface SidecarState {
  handle: PlaywrightHandle | null;
  /**
   * Set after a successful auto-install of browser binaries so the next
   * tool result can carry a `notice` letting the user/model know the
   * one-time download happened. Cleared once the notice has been
   * delivered (handed to the reply once, then forgotten).
   */
  pendingInstallNotice: string | null;
}

async function ensurePlaywright(
  state: SidecarState,
  opts: { browser?: BrowserKind; headless?: boolean },
): Promise<PlaywrightHandle> {
  if (state.handle) return state.handle;
  const pw = await importPlaywright();
  const which = opts.browser ?? 'chromium';
  const browserType = pw[which];
  const { handle, installNotice } = await launchWithAutoInstall(browserType, which, opts.headless ?? true);
  state.handle = handle;
  if (installNotice) state.pendingInstallNotice = installNotice;
  return state.handle;
}

export async function teardown(state: SidecarState): Promise<void> {
  if (!state.handle) return;
  try {
    await state.handle.context.close();
    await state.handle.browser.close();
  } catch {
    /* ignore */
  }
  state.handle = null;
  tabRegistries.delete(state);
}

async function tabRegistry(state: SidecarState): Promise<{
  handle: PlaywrightHandle;
  registry: PlaywrightTabRegistry;
}> {
  const handle = await ensurePlaywright(state, {});
  let registry = tabRegistries.get(state);
  if (!registry) {
    const id = randomUUID();
    registry = { activeTabId: id, pages: new Map([[id, handle.page]]) };
    tabRegistries.set(state, registry);
  }
  return { handle, registry };
}

async function resolvePage(
  state: SidecarState,
  requestedTabId?: string,
): Promise<{ handle: PlaywrightHandle; registry: PlaywrightTabRegistry; tabId: string; page: PageHandle }> {
  const { handle, registry } = await tabRegistry(state);
  const tabId = requestedTabId ?? registry.activeTabId;
  const page = registry.pages.get(tabId);
  if (!page) throw badParams(`unknown browser tab: ${tabId}`);
  return { handle, registry, tabId, page };
}

async function tabSnapshot(registry: PlaywrightTabRegistry): Promise<{
  activeTabId: string;
  tabs: Array<{ id: string; title: string; url: string }>;
}> {
  const tabs = await Promise.all(
    Array.from(registry.pages, async ([id, page]) => ({
      id,
      title: page.title ? await page.title().catch(() => '') : '',
      url: page.url(),
    })),
  );
  return { activeTabId: registry.activeTabId, tabs };
}

export async function dispatch(state: SidecarState, req: Req): Promise<Reply> {
  try {
    return await dispatchInner(state, req);
  } catch (err) {
    return {
      id: req.id,
      ok: false,
      error: { message: errMsg(err), kind: err instanceof SidecarError ? err.kind : 'unknown' },
    };
  }
}

async function dispatchInner(state: SidecarState, req: Req): Promise<Reply> {
  switch (req.method) {
    case 'init': {
      const opts = (req.params ?? {}) as { browser?: BrowserKind; headless?: boolean };
      await ensurePlaywright(state, opts);
      return { id: req.id, ok: true, result: { ready: true } };
    }
    case 'goto': {
      const { url, waitUntil, timeoutMs, tabId } = (req.params ?? {}) as {
        url: string;
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
        timeoutMs?: number;
        tabId?: string;
      };
      if (!url) throw badParams('url is required');
      // Defence-in-depth: the parent already runs the full SSRF guard before
      // sending this RPC, but the sidecar is a distinct process driven over
      // JSON-RPC, so re-check here rather than trust the caller to have
      // validated. Blocks file:// / javascript: schemes AND loopback/private/
      // link-local (incl. 169.254.169.254 metadata)/CGNAT targets, resolving
      // hostnames. Runs BEFORE ensurePlaywright so a blocked URL never
      // launches (or auto-installs) a browser.
      try {
        // fail-closed: the browser resolves names with Chromium's own resolver,
        // so a name node:dns can't vet must not pass through un-checked.
        await assertPublicUrl(url, 'goto', { failClosed: true });
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      const target = await resolvePage(state, tabId);
      try {
        await target.page.goto(url, { waitUntil: waitUntil ?? 'domcontentloaded', timeout: timeoutMs ?? 30_000 });
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      return { id: req.id, ok: true, result: { url: target.page.url(), tabId: target.tabId } };
    }
    case 'click': {
      const { selector, timeoutMs, tabId } = (req.params ?? {}) as { selector: string; timeoutMs?: number; tabId?: string };
      if (!selector) throw badParams('selector is required');
      const target = await resolvePage(state, tabId);
      await target.page.click(selector, { timeout: timeoutMs ?? 10_000 });
      return { id: req.id, ok: true };
    }
    case 'fill': {
      const { selector, value, timeoutMs, tabId } = (req.params ?? {}) as {
        selector: string;
        value: string;
        timeoutMs?: number;
        tabId?: string;
      };
      if (!selector) throw badParams('selector is required');
      const target = await resolvePage(state, tabId);
      await target.page.fill(selector, value ?? '', { timeout: timeoutMs ?? 10_000 });
      return { id: req.id, ok: true };
    }
    case 'text': {
      const { selector, tabId } = (req.params ?? {}) as { selector?: string; tabId?: string };
      const target = await resolvePage(state, tabId);
      if (selector) {
        const text = await target.page.textContent(selector);
        return { id: req.id, ok: true, result: text ?? '' };
      }
      // Whole-document text via evaluate
      const text = (await target.page.evaluate('document.body ? document.body.innerText : ""')) as string;
      return { id: req.id, ok: true, result: text };
    }
    case 'html': {
      const { tabId } = (req.params ?? {}) as { tabId?: string };
      const target = await resolvePage(state, tabId);
      const html = await target.page.content();
      return { id: req.id, ok: true, result: html };
    }
    case 'screenshot': {
      const { fullPage, tabId } = (req.params ?? {}) as { fullPage?: boolean; tabId?: string };
      const target = await resolvePage(state, tabId);
      const buf = await target.page.screenshot({ fullPage: fullPage ?? false, timeout: SCREENSHOT_TIMEOUT_MS });
      return { id: req.id, ok: true, result: { mediaType: 'image/png', base64: buf.toString('base64') } };
    }
    case 'frame': {
      // Combined live-view frame for the browser SURFACE: a JPEG screenshot
      // plus the current url + viewport size, so the renderer can map clicks
      // back onto the page. One round-trip per frame.
      const { page } = await resolvePage(state);
      // quality 70 (was 55) + the context's deviceScaleFactor:2 = legible text in
      // the live view. Reports the CSS viewport size (the image is 2× that) so the
      // renderer keeps mapping clicks in CSS coords.
      const buf = await page.screenshot({ type: 'jpeg', quality: 70, timeout: SCREENSHOT_TIMEOUT_MS });
      const vp = page.viewportSize() ?? { width: 1280, height: 720 };
      return {
        id: req.id,
        ok: true,
        result: {
          mediaType: 'image/jpeg',
          base64: buf.toString('base64'),
          url: page.url(),
          width: vp.width,
          height: vp.height,
        },
      };
    }
    case 'mouse': {
      const { x, y, count } = (req.params ?? {}) as { x: number; y: number; count?: number };
      // Parity with `key`/`eval`: validate before launching/driving the page so
      // a malformed surface message (missing/NaN coords) surfaces a clean
      // `badParams` instead of an opaque Playwright throw from click(undefined).
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw badParams('x and y must be finite numbers');
      const { page } = await resolvePage(state);
      await page.mouse.click(x, y, { clickCount: Math.min(3, Math.max(1, count ?? 1)) });
      return { id: req.id, ok: true, result: { url: page.url() } };
    }
    case 'mousemove': {
      // Hover: drives the page's pointer so :hover styles / tooltips render in
      // the polled frame. Cheap; the surface throttles how often it sends these.
      const { x, y } = (req.params ?? {}) as { x: number; y: number };
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw badParams('x and y must be finite numbers');
      const { page } = await resolvePage(state);
      await page.mouse.move(x, y);
      return { id: req.id, ok: true };
    }
    case 'setviewport': {
      // Resize the page to the pane so the live view fills the container instead
      // of being letterboxed at the default 1280×720.
      const { width, height } = (req.params ?? {}) as { width: number; height: number };
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw badParams('width and height must be positive finite numbers');
      }
      // Clamp to Chromium's max so a malformed surface message (width:1e9) can't
      // trigger a multi-GB allocation / opaque Playwright throw.
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw badParams(`width and height must be <= ${MAX_DIMENSION}`);
      }
      const { page } = await resolvePage(state);
      await page.setViewportSize({ width: Math.round(width), height: Math.round(height) });
      return { id: req.id, ok: true };
    }
    case 'back':
    case 'forward':
    case 'reload': {
      const { page } = await resolvePage(state);
      try {
        if (req.method === 'back') await page.goBack();
        else if (req.method === 'forward') await page.goForward();
        else await page.reload();
      } catch (err) {
        // No history to go to is not an error worth failing the surface over.
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      return { id: req.id, ok: true, result: { url: page.url() } };
    }
    case 'key': {
      const { key } = (req.params ?? {}) as { key: string };
      if (!key) throw badParams('key is required');
      const { page } = await resolvePage(state);
      // A single printable char is typed (inserts it); a named key is pressed.
      if (key.length === 1) await page.keyboard.type(key);
      else await page.keyboard.press(key);
      return { id: req.id, ok: true };
    }
    case 'scroll': {
      const { page } = await resolvePage(state);
      const { dy } = (req.params ?? {}) as { dy: number };
      await page.mouse.wheel(0, dy ?? 0);
      return { id: req.id, ok: true };
    }
    case 'zoom': {
      // Page zoom for the surface (⌘+/⌘−). CSS `zoom` is the cheapest faithful
      // way to scale a screenshot-streamed page; clamped to a sane range.
      const { factor } = (req.params ?? {}) as { factor: number };
      const f = Number.isFinite(factor) ? Math.min(5, Math.max(0.25, factor)) : 1;
      const { page } = await resolvePage(state);
      await page.evaluate(`document.documentElement.style.zoom=String(${f})`);
      return { id: req.id, ok: true };
    }
    case 'capture': {
      // Sharp PNG of a region the user dragged — attached to the chat composer so
      // the agent SEES the area ("change this to …"). Coords are CSS px; the
      // context's deviceScaleFactor:2 makes the PNG 2× → crisp.
      const { x, y, width, height } = (req.params ?? {}) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      if (![x, y, width, height].every((n) => Number.isFinite(n)) || width < 1 || height < 1) {
        throw badParams('x, y, width, height must be finite; width/height positive');
      }
      // Bound the clip so an enormous (or hostile, viewport-multiplied) region
      // can't request a multi-GB screenshot allocation.
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw badParams(`clip width and height must be <= ${MAX_DIMENSION}`);
      }
      const { page } = await resolvePage(state);
      const buf = await page.screenshot({ type: 'png', clip: { x, y, width, height }, timeout: SCREENSHOT_TIMEOUT_MS });
      return { id: req.id, ok: true, result: { mediaType: 'image/png', base64: buf.toString('base64') } };
    }
    case 'pick': {
      // Identify the element at (x,y) so the user can hand it to the agent
      // ("change this XXX to YYY"). Returns a best-effort CSS selector + a short
      // text snippet; the agent's browser_session tool can act on the selector.
      const { x, y } = (req.params ?? {}) as { x: number; y: number };
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw badParams('x and y must be finite numbers');
      const { page } = await resolvePage(state);
      const expr =
        `(() => { const x=${x}, y=${y}; const el=document.elementFromPoint(x,y);` +
        ` if(!el) return null;` +
        ` const sel=(e)=>{ if(e.id) return '#'+CSS.escape(e.id); const p=[]; let n=e;` +
        ` while(n && n.nodeType===1 && n!==document.body){ let s=n.tagName.toLowerCase();` +
        ` if(n.classList && n.classList.length) s+='.'+Array.from(n.classList).slice(0,2).map(c=>CSS.escape(c)).join('.');` +
        ` const par=n.parentElement; if(par){ const same=Array.from(par.children).filter(c=>c.tagName===n.tagName);` +
        ` if(same.length>1) s+=':nth-of-type('+(same.indexOf(n)+1)+')'; } p.unshift(s); n=n.parentElement; }` +
        ` return p.join(' > '); };` +
        ` return { selector: sel(el), tag: el.tagName.toLowerCase(), text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,140) }; })()`;
      const info = await page.evaluate(expr);
      return { id: req.id, ok: true, result: info };
    }
    case 'eval': {
      const { expression, tabId } = (req.params ?? {}) as { expression: string; tabId?: string };
      if (!expression) throw badParams('expression is required');
      const target = await resolvePage(state, tabId);
      const value = await target.page.evaluate(expression);
      return { id: req.id, ok: true, result: value };
    }
    case 'url': {
      const { tabId } = (req.params ?? {}) as { tabId?: string };
      const target = await resolvePage(state, tabId);
      return { id: req.id, ok: true, result: target.page.url() };
    }
    case 'tabs': {
      const { registry } = await tabRegistry(state);
      return { id: req.id, ok: true, result: await tabSnapshot(registry) };
    }
    case 'new_tab': {
      const { url } = (req.params ?? {}) as { url?: string };
      if (url) {
        try {
          await assertPublicUrl(url, 'new_tab', { failClosed: true });
        } catch (error) {
          return { id: req.id, ok: false, error: { message: errMsg(error), kind: 'navigation' } };
        }
      }
      const { handle, registry } = await tabRegistry(state);
      const page = (await handle.context.newPage()) as PageHandle;
      const tabId = randomUUID();
      registry.pages.set(tabId, page);
      registry.activeTabId = tabId;
      if (url) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (error) {
          return { id: req.id, ok: false, error: { message: errMsg(error), kind: 'navigation' } };
        }
      }
      return { id: req.id, ok: true, result: await tabSnapshot(registry) };
    }
    case 'select_tab': {
      const { tabId } = (req.params ?? {}) as { tabId?: string };
      if (!tabId) throw badParams('tabId is required');
      const { registry } = await resolvePage(state, tabId);
      registry.activeTabId = tabId;
      return { id: req.id, ok: true, result: await tabSnapshot(registry) };
    }
    case 'close_tab': {
      const { tabId } = (req.params ?? {}) as { tabId?: string };
      if (!tabId) throw badParams('tabId is required');
      const { handle, registry, page } = await resolvePage(state, tabId);
      await page.close();
      registry.pages.delete(tabId);
      if (registry.pages.size === 0) {
        const replacementId = randomUUID();
        const replacement = (await handle.context.newPage()) as PageHandle;
        registry.pages.set(replacementId, replacement);
        registry.activeTabId = replacementId;
      } else if (registry.activeTabId === tabId) {
        const next = registry.pages.keys().next();
        if (next.done) throw new Error('browser tab registry lost its remaining tab');
        registry.activeTabId = next.value;
      }
      return { id: req.id, ok: true, result: await tabSnapshot(registry) };
    }
    case 'close': {
      await teardown(state);
      return { id: req.id, ok: true };
    }
    default:
      return {
        id: req.id,
        ok: false,
        error: { message: `unknown method: ${req.method}`, kind: 'runtime' },
      };
  }
}
