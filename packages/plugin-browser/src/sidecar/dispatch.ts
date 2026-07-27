/**
 * JSON-RPC dispatch table for the sidecar. Each `method` here corresponds
 * one-to-one with the wire-format methods documented in `sidecar.ts`.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { BrowserTarget } from '../browser-action.js';
import {
  buildBrowserObservationScript,
  buildBrowserInspectScript,
  buildBrowserRefPointScript,
  buildBrowserRefValidationScript,
  buildBrowserSelectorPointScript,
  buildSanitizedDocumentHtmlScript,
  formatBrowserObservationForModel,
  parseBrowserObservation,
  withBrowserObservationDelta,
  type BrowserObservation,
  type BrowserObservationTarget,
} from '../browser-observation.js';
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
const observationRegistries = new WeakMap<
  PageHandle,
  Map<string, ReadonlyMap<string, BrowserObservationTarget>>
>();
const previousObservations = new WeakMap<PageHandle, BrowserObservation>();

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

interface BrowserPoint {
  readonly x: number;
  readonly y: number;
}

function parsePoint(value: unknown, error: string): BrowserPoint {
  if (!value || typeof value !== 'object') throw badParams(error);
  const point = value as { x?: unknown; y?: unknown; stale?: unknown };
  if (point.stale === true) throw badParams('STALE_BROWSER_STATE: observe the page again');
  if (typeof point.x !== 'number' || !Number.isFinite(point.x)) throw badParams(error);
  if (typeof point.y !== 'number' || !Number.isFinite(point.y)) throw badParams(error);
  return { x: point.x, y: point.y };
}

async function resolveBrowserTarget(
  page: PageHandle,
  target: BrowserTarget,
): Promise<{ readonly point: BrowserPoint; readonly selector?: string }> {
  if (target.type === 'point') {
    const viewport = page.viewportSize() ?? { width: 1_280, height: 720 };
    return {
      point: {
        x: (target.x / 1_000) * viewport.width,
        y: (target.y / 1_000) * viewport.height,
      },
    };
  }
  if (target.type === 'selector') {
    return {
      selector: target.selector,
      point: parsePoint(
        await page.evaluate(buildBrowserSelectorPointScript(target.selector)),
        `ELEMENT_NOT_FOUND: ${target.selector}`,
      ),
    };
  }
  const observations = observationRegistries.get(page);
  const observation = observations?.get(target.revision);
  const stored = observation?.get(target.ref);
  if (!stored) throw badParams('STALE_BROWSER_STATE: observe the page again');
  return {
    selector: stored.selector,
    point: parsePoint(
      await page.evaluate(buildBrowserRefPointScript(stored, target.revision)),
      'STALE_BROWSER_STATE: observe the page again',
    ),
  };
}

function rememberObservation(
  page: PageHandle,
  revision: string,
  targets: ReadonlyMap<string, BrowserObservationTarget>,
): void {
  let observations = observationRegistries.get(page);
  if (!observations) {
    observations = new Map();
    observationRegistries.set(page, observations);
  }
  observations.set(revision, targets);
  while (observations.size > 3) {
    const oldest = observations.keys().next().value as string | undefined;
    if (!oldest) break;
    observations.delete(oldest);
  }
}

async function selectorForTarget(page: PageHandle, target: BrowserTarget): Promise<string> {
  if (target.type === 'selector') return target.selector;
  if (target.type === 'point') throw badParams('action requires a ref or selector target');
  const observations = observationRegistries.get(page);
  const revision = observations?.get(target.revision);
  const stored = revision?.get(target.ref);
  if (!stored) throw badParams('STALE_BROWSER_STATE: observe the page again');
  const current = await page.evaluate(buildBrowserRefValidationScript(stored, target.revision));
  if (current !== true) throw badParams('STALE_BROWSER_STATE: observe the page again');
  if (!stored.selector) throw badParams('ELEMENT_NOT_INTERACTABLE: selector target required');
  return stored.selector;
}

function keyChord(key: string, modifiers: ReadonlyArray<string> | undefined): string {
  const prefixes = (modifiers ?? []).map((modifier) => {
    if (modifier === 'control') return 'Control';
    return modifier.slice(0, 1).toUpperCase() + modifier.slice(1);
  });
  return [...prefixes, key].join('+');
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
      const { selector, target: requestedTarget, tabId, button, count } = (req.params ?? {}) as {
        selector?: string;
        target?: BrowserTarget;
        tabId?: string;
        button?: 'left' | 'middle' | 'right';
        count?: number;
      };
      const effectiveTarget = requestedTarget ?? (selector
        ? { type: 'selector' as const, selector }
        : undefined);
      if (!effectiveTarget) throw badParams('click target is required');
      const target = await resolvePage(state, tabId);
      const resolved = await resolveBrowserTarget(target.page, effectiveTarget);
      await target.page.mouse.click(resolved.point.x, resolved.point.y, {
        button: button ?? 'left',
        clickCount: count ?? 1,
      });
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'observe': {
      const { mode, maxNodes, maxTextChars, tabId } = (req.params ?? {}) as {
        mode?: 'auto' | 'semantic' | 'visual' | 'hybrid';
        maxNodes?: number;
        maxTextChars?: number;
        tabId?: string;
      };
      const target = await resolvePage(state, tabId);
      const parsed = parseBrowserObservation(
        await target.page.evaluate(
          buildBrowserObservationScript(maxNodes ?? 120, maxTextChars ?? 6_000),
        ),
      );
      rememberObservation(target.page, parsed.observation.revision, parsed.targets);
      const previous = previousObservations.get(target.page);
      const effectiveMode = mode === 'auto' || mode === undefined
        ? (!previous || parsed.observation.visualSurface || parsed.observation.nodes.length < 8
            ? 'hybrid'
            : 'semantic')
        : mode;
      const nodes = effectiveMode === 'visual' ? [] : parsed.observation.nodes;
      if (effectiveMode === 'visual' || effectiveMode === 'hybrid') {
        const image = await captureModelScreenshot(target.page);
        const current: BrowserObservation = {
          ...parsed.observation,
          stateVersion: 3,
          domRevision: parsed.observation.revision,
          visualRevision: createHash('sha256').update(image).digest('hex').slice(0, 24),
          nodes,
        };
        const hasNewVisualState = previous?.visualRevision !== current.visualRevision;
        const observation = withBrowserObservationDelta(previous, current);
        previousObservations.set(target.page, current);
        return {
          id: req.id,
          ok: true,
          result: {
            ...observation,
            tabId: target.tabId,
            ...(hasNewVisualState
              ? { mediaType: 'image/jpeg', base64: image.toString('base64') }
              : {}),
            forModel: formatBrowserObservationForModel(observation),
          },
        };
      }
      const current: BrowserObservation = {
        ...parsed.observation,
        stateVersion: 3,
        domRevision: parsed.observation.revision,
        nodes,
      };
      const observation = withBrowserObservationDelta(previous, current);
      previousObservations.set(target.page, current);
      return {
        id: req.id,
        ok: true,
        result: {
          ...observation,
          tabId: target.tabId,
          forModel: formatBrowserObservationForModel(observation),
        },
      };
    }
    case 'inspect': {
      const { target: requestedTarget, tabId } = (req.params ?? {}) as {
        target?: BrowserTarget;
        tabId?: string;
      };
      if (!requestedTarget) throw badParams('inspect target is required');
      const target = await resolvePage(state, tabId);
      const resolved = await resolveBrowserTarget(target.page, requestedTarget);
      const inspection = await target.page.evaluate(buildBrowserInspectScript(resolved));
      if (!inspection) throw badParams('ELEMENT_NOT_FOUND: inspect target is unavailable');
      return { id: req.id, ok: true, result: { tabId: target.tabId, inspection } };
    }
    case 'hover': {
      const { target: requestedTarget, tabId } = (req.params ?? {}) as {
        target?: BrowserTarget;
        tabId?: string;
      };
      if (!requestedTarget) throw badParams('hover target is required');
      const target = await resolvePage(state, tabId);
      const resolved = await resolveBrowserTarget(target.page, requestedTarget);
      await target.page.mouse.move(resolved.point.x, resolved.point.y);
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'type': {
      const { target: requestedTarget, value, replace, timeoutMs, tabId } = (req.params ?? {}) as {
        target?: BrowserTarget;
        value?: string;
        replace?: boolean;
        timeoutMs?: number;
        tabId?: string;
      };
      if (!requestedTarget || requestedTarget.type === 'point') {
        throw badParams('type requires a ref or selector target');
      }
      const target = await resolvePage(state, tabId);
      const resolved = await resolveBrowserTarget(target.page, requestedTarget);
      if (!resolved.selector) throw badParams('type target is not text-addressable');
      if (replace ?? true) {
        await target.page.fill(resolved.selector, value ?? '', { timeout: timeoutMs ?? 10_000 });
      } else {
        await target.page.click(resolved.selector, { timeout: timeoutMs ?? 10_000 });
        await target.page.keyboard.type(value ?? '');
      }
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'press': {
      const { key, modifiers, target: requestedTarget, tabId } = (req.params ?? {}) as {
        key?: string;
        modifiers?: ReadonlyArray<string>;
        target?: BrowserTarget;
        tabId?: string;
      };
      if (!key) throw badParams('key is required');
      const target = await resolvePage(state, tabId);
      if (requestedTarget) {
        if (requestedTarget.type === 'point') throw badParams('press target must be a ref or selector');
        const resolved = await resolveBrowserTarget(target.page, requestedTarget);
        if (!resolved.selector) throw badParams('press target is not focusable');
        await target.page.click(resolved.selector);
      }
      await target.page.keyboard.press(keyChord(key, modifiers));
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'scroll': {
      const { deltaX, deltaY, dy, at, tabId } = (req.params ?? {}) as {
        deltaX?: number;
        deltaY?: number;
        dy?: number;
        at?: BrowserPoint;
        tabId?: string;
      };
      const target = await resolvePage(state, tabId);
      if (at) {
        const viewport = target.page.viewportSize() ?? { width: 1_280, height: 720 };
        await target.page.mouse.move((at.x / 1_000) * viewport.width, (at.y / 1_000) * viewport.height);
      }
      await target.page.mouse.wheel(deltaX ?? 0, deltaY ?? dy ?? 0);
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'drag': {
      const { from, to, steps, tabId } = (req.params ?? {}) as {
        from?: BrowserTarget;
        to?: BrowserTarget;
        steps?: number;
        tabId?: string;
      };
      if (!from || !to) throw badParams('drag requires from and to targets');
      const target = await resolvePage(state, tabId);
      const start = await resolveBrowserTarget(target.page, from);
      const end = await resolveBrowserTarget(target.page, to);
      await target.page.mouse.move(start.point.x, start.point.y);
      await target.page.mouse.down({ button: 'left' });
      await target.page.mouse.move(end.point.x, end.point.y, { steps: steps ?? 12 });
      await target.page.mouse.up({ button: 'left' });
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'select': {
      const { target: requestedTarget, values, timeoutMs, tabId } = (req.params ?? {}) as {
        target?: BrowserTarget;
        values?: ReadonlyArray<string>;
        timeoutMs?: number;
        tabId?: string;
      };
      if (!requestedTarget || !values || values.length === 0) {
        throw badParams('select requires a target and at least one value');
      }
      const target = await resolvePage(state, tabId);
      const selector = await selectorForTarget(target.page, requestedTarget);
      const selected = await target.page.selectOption(selector, values, {
        timeout: timeoutMs ?? 10_000,
      });
      return {
        id: req.id,
        ok: true,
        result: { tabId: target.tabId, url: target.page.url(), selected },
      };
    }
    case 'upload': {
      const { target: requestedTarget, paths, timeoutMs, tabId } = (req.params ?? {}) as {
        target?: BrowserTarget;
        paths?: ReadonlyArray<string>;
        timeoutMs?: number;
        tabId?: string;
      };
      if (!requestedTarget || !paths || paths.length === 0) {
        throw badParams('upload requires a target and at least one path');
      }
      const target = await resolvePage(state, tabId);
      const selector = await selectorForTarget(target.page, requestedTarget);
      await target.page.setInputFiles(selector, paths, { timeout: timeoutMs ?? 10_000 });
      return {
        id: req.id,
        ok: true,
        result: { tabId: target.tabId, url: target.page.url(), files: paths.length },
      };
    }
    case 'wait': {
      const { condition, timeoutMs, tabId } = (req.params ?? {}) as {
        condition?:
          | { type: 'target'; target: BrowserTarget; state: 'visible' | 'hidden' }
          | { type: 'text'; text: string }
          | { type: 'url'; includes: string }
          | { type: 'networkidle' };
        timeoutMs?: number;
        tabId?: string;
      };
      if (!condition) throw badParams('wait condition is required');
      const target = await resolvePage(state, tabId);
      const timeout = timeoutMs ?? 30_000;
      if (condition.type === 'networkidle') {
        await target.page.waitForLoadState('networkidle', { timeout });
      } else if (condition.type === 'target') {
        const selector = await selectorForTarget(target.page, condition.target);
        await target.page.waitForSelector(selector, { state: condition.state, timeout });
      } else if (condition.type === 'text') {
        await target.page.waitForFunction(
          '(expected) => Boolean(document.body?.innerText.includes(expected))',
          condition.text,
          { timeout },
        );
      } else {
        await target.page.waitForFunction(
          '(expected) => location.href.includes(expected)',
          condition.includes,
          { timeout },
        );
      }
      return { id: req.id, ok: true, result: { tabId: target.tabId, url: target.page.url() } };
    }
    case 'text': {
      const { selector, target: requestedTarget, tabId } = (req.params ?? {}) as {
        selector?: string;
        target?: BrowserTarget;
        tabId?: string;
      };
      const target = await resolvePage(state, tabId);
      const effectiveTarget = requestedTarget ?? (selector
        ? { type: 'selector' as const, selector }
        : undefined);
      if (effectiveTarget) {
        const resolvedSelector = await selectorForTarget(target.page, effectiveTarget);
        const text = await target.page.textContent(resolvedSelector);
        return { id: req.id, ok: true, result: text ?? '' };
      }
      // Whole-document text via evaluate
      const text = (await target.page.evaluate('document.body ? document.body.innerText : ""')) as string;
      return { id: req.id, ok: true, result: text };
    }
    case 'html': {
      const { tabId } = (req.params ?? {}) as { tabId?: string };
      const target = await resolvePage(state, tabId);
      const html = await target.page.evaluate(buildSanitizedDocumentHtmlScript());
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
      const { tabId } = (req.params ?? {}) as { tabId?: string };
      const { page } = await resolvePage(state, tabId);
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

async function captureModelScreenshot(page: PageHandle): Promise<Buffer> {
  let image: Buffer = Buffer.alloc(0);
  for (const quality of [78, 64, 50, 36]) {
    image = await page.screenshot({
      type: 'jpeg',
      quality,
      fullPage: false,
      timeout: SCREENSHOT_TIMEOUT_MS,
    });
    if (image.length <= 500 * 1024) break;
  }
  return image;
}
