/**
 * JSON-RPC dispatch table for the sidecar. Each `method` here corresponds
 * one-to-one with the wire-format methods documented in `sidecar.ts`.
 */

import { assertPublicUrl } from '../ssrf-guard.js';
import { importPlaywright, launchWithAutoInstall } from './install.js';
import { opAct, opSnapshot, opTabs } from './agent-ops.js';
// SidecarState lives in a leaf module so `agent-ops` can import it without
// closing a cycle back through this file. Re-exported for existing importers.
import type { SidecarState } from './state.js';
export type { SidecarState, TabSnapshot } from './state.js';
import { TabRegistry } from './tabs.js';
import {
  badParams,
  errMsg,
  SidecarError,
  type BrowserKind,
  type PageHandle,
  type PlaywrightHandle,
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


/**
 * Make sure the tab registry exists and knows about every page the context
 * already owns. Called after `ensurePlaywright` so the launch page is always
 * tab 1, and hooked to `context.on('page')` so a popup or a `target="_blank"`
 * link becomes an addressable tab instead of a document nobody can reach.
 */
function ensureTabs(state: SidecarState, handle: PlaywrightHandle): TabRegistry {
  if (state.tabs) return state.tabs;
  const registry = new TabRegistry();
  registry.add(handle.page);

  // Pages the context opened before we looked (rare, but a `newPage` during
  // launch would qualify) plus everything it opens from here on.
  for (const page of handle.context.pages?.() ?? []) {
    if (page !== handle.page) registry.add(page);
  }
  handle.context.on?.('page', (page: PageHandle) => {
    registry.add(page);
  });

  state.tabs = registry;
  return registry;
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
    // ── Agent-facing perception + action, addressed by tab and uid. ──
    // These own their error replies (each has several distinct refusal
    // reasons worth telling the model apart), so they are not wrapped by the
    // generic catch in `dispatch`.
    case 'snapshot': {
      const h = await ensurePlaywright(state, {});
      ensureTabs(state, h);
      return opSnapshot(state, h, req);
    }
    case 'act': {
      const h = await ensurePlaywright(state, {});
      ensureTabs(state, h);
      return opAct(state, h, req);
    }
    case 'tabs': {
      const h = await ensurePlaywright(state, {});
      ensureTabs(state, h);
      return opTabs(state, h, req);
    }
    case 'goto': {
      const { url, waitUntil, timeoutMs, tab_id } = (req.params ?? {}) as {
        url: string;
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
        timeoutMs?: number;
        tab_id?: string;
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
      const h = await ensurePlaywright(state, {});
      // Named tabs: an explicit tab_id targets that tab, omitting it keeps the
      // historical behaviour of navigating whatever is active.
      const registry = ensureTabs(state, h);
      const target = registry.get(tab_id);
      try {
        await target.page.goto(url, { waitUntil: waitUntil ?? 'domcontentloaded', timeout: timeoutMs ?? 30_000 });
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      // Every uid from the previous snapshot belonged to the previous document.
      // Dropping them here means the next `act` fails with "take a fresh
      // snapshot" instead of resolving a handle onto whatever now sits at that
      // position.
      state.snapshots?.delete(target.id);
      return { id: req.id, ok: true, result: { url: target.page.url(), tabId: target.id } };
    }
    case 'click': {
      const h = await ensurePlaywright(state, {});
      const { selector, timeoutMs } = (req.params ?? {}) as { selector: string; timeoutMs?: number };
      if (!selector) throw badParams('selector is required');
      await h.page.click(selector, { timeout: timeoutMs ?? 10_000 });
      return { id: req.id, ok: true };
    }
    case 'fill': {
      const h = await ensurePlaywright(state, {});
      const { selector, value, timeoutMs } = (req.params ?? {}) as {
        selector: string;
        value: string;
        timeoutMs?: number;
      };
      if (!selector) throw badParams('selector is required');
      await h.page.fill(selector, value ?? '', { timeout: timeoutMs ?? 10_000 });
      return { id: req.id, ok: true };
    }
    case 'text': {
      const h = await ensurePlaywright(state, {});
      const { selector } = (req.params ?? {}) as { selector?: string };
      if (selector) {
        const text = await h.page.textContent(selector);
        return { id: req.id, ok: true, result: text ?? '' };
      }
      // Whole-document text via evaluate
      const text = (await h.page.evaluate('document.body ? document.body.innerText : ""')) as string;
      return { id: req.id, ok: true, result: text };
    }
    case 'html': {
      const h = await ensurePlaywright(state, {});
      const html = await h.page.content();
      return { id: req.id, ok: true, result: html };
    }
    case 'screenshot': {
      const h = await ensurePlaywright(state, {});
      const { fullPage } = (req.params ?? {}) as { fullPage?: boolean };
      const buf = await h.page.screenshot({ fullPage: fullPage ?? false, timeout: SCREENSHOT_TIMEOUT_MS });
      return { id: req.id, ok: true, result: { mediaType: 'image/png', base64: buf.toString('base64') } };
    }
    case 'frame': {
      // Combined live-view frame for the browser SURFACE: a JPEG screenshot
      // plus the current url + viewport size, so the renderer can map clicks
      // back onto the page. One round-trip per frame.
      const h = await ensurePlaywright(state, {});
      // `scale: 'css'` pins the image to ONE pixel per CSS pixel. The context
      // runs at deviceScaleFactor 2 so that `capture` and `screenshot` come out
      // crisp, but the live view does not need that: at a 1280×720 viewport the
      // default 'device' scale encodes 2560×1440 — four times the pixels — and
      // then ships them through the sidecar pipe, the runner and IPC several
      // times a second. Crispness matters for a still the model or the user
      // reads; it does not matter for a preview that is about to be replaced.
      // The reported size stays the CSS viewport either way, so click mapping
      // is unaffected.
      const buf = await h.page.screenshot({
        type: 'jpeg',
        quality: 70,
        scale: 'css',
        timeout: SCREENSHOT_TIMEOUT_MS,
      });
      const vp = h.page.viewportSize() ?? { width: 1280, height: 720 };
      return {
        id: req.id,
        ok: true,
        result: {
          mediaType: 'image/jpeg',
          base64: buf.toString('base64'),
          url: h.page.url(),
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
      const h = await ensurePlaywright(state, {});
      await h.page.mouse.click(x, y, { clickCount: Math.min(3, Math.max(1, count ?? 1)) });
      return { id: req.id, ok: true, result: { url: h.page.url() } };
    }
    case 'mousemove': {
      // Hover: drives the page's pointer so :hover styles / tooltips render in
      // the polled frame. Cheap; the surface throttles how often it sends these.
      const { x, y } = (req.params ?? {}) as { x: number; y: number };
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw badParams('x and y must be finite numbers');
      const h = await ensurePlaywright(state, {});
      await h.page.mouse.move(x, y);
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
      const h = await ensurePlaywright(state, {});
      await h.page.setViewportSize({ width: Math.round(width), height: Math.round(height) });
      return { id: req.id, ok: true };
    }
    case 'back':
    case 'forward':
    case 'reload': {
      const h = await ensurePlaywright(state, {});
      try {
        if (req.method === 'back') await h.page.goBack();
        else if (req.method === 'forward') await h.page.goForward();
        else await h.page.reload();
      } catch (err) {
        // No history to go to is not an error worth failing the surface over.
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      return { id: req.id, ok: true, result: { url: h.page.url() } };
    }
    case 'key': {
      const h = await ensurePlaywright(state, {});
      const { key } = (req.params ?? {}) as { key: string };
      if (!key) throw badParams('key is required');
      // A single printable char is typed (inserts it); a named key is pressed.
      if (key.length === 1) await h.page.keyboard.type(key);
      else await h.page.keyboard.press(key);
      return { id: req.id, ok: true };
    }
    case 'scroll': {
      const h = await ensurePlaywright(state, {});
      const { dy } = (req.params ?? {}) as { dy: number };
      await h.page.mouse.wheel(0, dy ?? 0);
      return { id: req.id, ok: true };
    }
    case 'zoom': {
      // Page zoom for the surface (⌘+/⌘−). CSS `zoom` is the cheapest faithful
      // way to scale a screenshot-streamed page; clamped to a sane range.
      const { factor } = (req.params ?? {}) as { factor: number };
      const f = Number.isFinite(factor) ? Math.min(5, Math.max(0.25, factor)) : 1;
      const h = await ensurePlaywright(state, {});
      await h.page.evaluate(`document.documentElement.style.zoom=String(${f})`);
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
      const h = await ensurePlaywright(state, {});
      const buf = await h.page.screenshot({ type: 'png', clip: { x, y, width, height }, timeout: SCREENSHOT_TIMEOUT_MS });
      return { id: req.id, ok: true, result: { mediaType: 'image/png', base64: buf.toString('base64') } };
    }
    case 'pick': {
      // Identify the element at (x,y) so the user can hand it to the agent
      // ("change this XXX to YYY"). Returns a best-effort CSS selector + a short
      // text snippet; the agent's browser_session tool can act on the selector.
      const { x, y } = (req.params ?? {}) as { x: number; y: number };
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw badParams('x and y must be finite numbers');
      const h = await ensurePlaywright(state, {});
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
      const info = await h.page.evaluate(expr);
      return { id: req.id, ok: true, result: info };
    }
    case 'eval': {
      const h = await ensurePlaywright(state, {});
      const { expression } = (req.params ?? {}) as { expression: string };
      if (!expression) throw badParams('expression is required');
      const value = await h.page.evaluate(expression);
      return { id: req.id, ok: true, result: value };
    }
    case 'url': {
      const h = await ensurePlaywright(state, {});
      return { id: req.id, ok: true, result: h.page.url() };
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
