/**
 * JSON-RPC dispatch table for the sidecar. Each `method` here corresponds
 * one-to-one with the wire-format methods documented in `sidecar.ts`.
 */

import { assertPublicUrl } from '../ssrf-guard.js';
import { importPlaywright, launchWithAutoInstall } from './install.js';
import {
  badParams,
  errMsg,
  type BrowserKind,
  type CDPSession,
  type Err,
  type PlaywrightHandle,
  type Reply,
  type Req,
} from './types.js';

export interface SidecarState {
  handle: PlaywrightHandle | null;
  /**
   * Set after a successful auto-install of browser binaries so the next
   * tool result can carry a `notice` letting the user/model know the
   * one-time download happened. Cleared once the notice has been
   * delivered (handed to the reply once, then forgotten).
   */
  pendingInstallNotice: string | null;
  /**
   * Emit an unsolicited event line to the parent (no `id`). Set by the sidecar
   * main loop; used to push `screencastFrame` events for the live browser
   * surface. Undefined in unit tests that call `dispatch` directly.
   */
  emit?: (event: Record<string, unknown>) => void;
  /** Active CDP screencast session, when the browser surface is open. */
  cdp?: CDPSession | null;
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
  await stopScreencast(state);
  if (!state.handle) return;
  try {
    await state.handle.context.close();
    await state.handle.browser.close();
  } catch {
    /* ignore */
  }
  state.handle = null;
}

async function stopScreencast(state: SidecarState): Promise<void> {
  if (!state.cdp) return;
  try {
    await state.cdp.send('Page.stopScreencast');
  } catch {
    /* page may already be gone */
  }
  try {
    await state.cdp.detach();
  } catch {
    /* ignore */
  }
  state.cdp = null;
}

export async function dispatch(state: SidecarState, req: Req): Promise<Reply> {
  try {
    return await dispatchInner(state, req);
  } catch (err) {
    const kind = (err as Error & { kind?: string }).kind;
    return {
      id: req.id,
      ok: false,
      error: { message: errMsg(err), kind: (kind as Err['error']['kind']) ?? 'unknown' },
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
      const { url, waitUntil, timeoutMs } = (req.params ?? {}) as {
        url: string;
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
        timeoutMs?: number;
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
        await assertPublicUrl(url, 'goto');
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      const h = await ensurePlaywright(state, {});
      try {
        await h.page.goto(url, { waitUntil: waitUntil ?? 'domcontentloaded', timeout: timeoutMs ?? 30_000 });
      } catch (err) {
        return { id: req.id, ok: false, error: { message: errMsg(err), kind: 'navigation' } };
      }
      return { id: req.id, ok: true, result: { url: h.page.url() } };
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
      const buf = await h.page.screenshot({ fullPage: fullPage ?? false });
      return { id: req.id, ok: true, result: { mediaType: 'image/png', base64: buf.toString('base64') } };
    }
    case 'frame': {
      // Combined live-view frame for the browser SURFACE: a JPEG screenshot
      // plus the current url + viewport size, so the renderer can map clicks
      // back onto the page. One round-trip per frame.
      const h = await ensurePlaywright(state, {});
      const buf = await h.page.screenshot({ type: 'jpeg', quality: 55 });
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
      const h = await ensurePlaywright(state, {});
      const { x, y } = (req.params ?? {}) as { x: number; y: number };
      await h.page.mouse.click(x, y);
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
    case 'startScreencast': {
      // Push live JPEG frames over CDP (`Page.screencastFrame`) for the browser
      // SURFACE — far smoother than polling screenshots. Chromium-only.
      const h = await ensurePlaywright(state, {});
      if (state.cdp) return { id: req.id, ok: true, result: { url: h.page.url() } };
      if (!h.context.newCDPSession) {
        return {
          id: req.id,
          ok: false,
          error: { message: 'screencast requires Chromium (CDP unavailable)', kind: 'runtime' },
        };
      }
      const client = await h.context.newCDPSession(h.page);
      state.cdp = client;
      client.on('Page.screencastFrame', (params) => {
        const p = params as { data: string; sessionId: number };
        state.emit?.({ event: 'screencastFrame', data: p.data, url: h.page.url() });
        // Ack so Chromium keeps streaming (it pauses without an ack).
        void client.send('Page.screencastAck', { sessionId: p.sessionId }).catch(() => undefined);
      });
      const { maxWidth, maxHeight } = (req.params ?? {}) as { maxWidth?: number; maxHeight?: number };
      await client.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 50,
        maxWidth: maxWidth ?? 1280,
        maxHeight: maxHeight ?? 800,
        everyNthFrame: 1,
      });
      return { id: req.id, ok: true, result: { url: h.page.url() } };
    }
    case 'stopScreencast': {
      await stopScreencast(state);
      return { id: req.id, ok: true };
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
