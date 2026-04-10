#!/usr/bin/env node
// Moxxy Playwright sidecar.
//
// Reads line-delimited JSON-RPC requests from stdin and writes line-delimited
// JSON responses to stdout. Supervised by `browser::Manager` in moxxy-runtime.
//
// Request : { "id": <u64>, "method": "<string>", "params": <object> }
// Response: { "id": <u64>, "ok": true,  "result": <any> }
//         | { "id": <u64>, "ok": false, "error": { "code": "<string>", "message": "<string>" } }
//
// All logging goes to stderr — stdout is reserved for JSON responses.

import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

// ----- runtime state ---------------------------------------------------------

/** @type {import('playwright-core').Browser | null} */
let browser = null;

/** @type {Map<string, import('playwright-core').BrowserContext>} */
const sessions = new Map();

/** @type {Map<string, { sessionId: string, page: import('playwright-core').Page }>} */
const pages = new Map();

// Per-session list of page ids for cleanup tracking.
/** @type {Map<string, Set<string>>} */
const sessionPages = new Map();

// Defaults / caps. Rust may pass tighter values; we never go looser.
const MAX_HTML_BYTES = 4 * 1024 * 1024;        // 4 MiB
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;  // 8 MiB
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ----- helpers ---------------------------------------------------------------

function log(...args) {
  process.stderr.write('[playwright-sidecar] ' + args.map(stringify).join(' ') + '\n');
}

function stringify(v) {
  if (v instanceof Error) return v.stack ?? v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function clampTimeout(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(n)));
}

function clampMaxBytes(raw, hardCap) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return hardCap;
  return Math.min(hardCap, Math.floor(n));
}

function mustHave(params, key) {
  if (params == null || params[key] == null) {
    throw new RpcError('invalid_params', `missing required parameter '${key}'`);
  }
  return params[key];
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getPage(pageId) {
  const entry = pages.get(pageId);
  if (!entry) throw new RpcError('not_found', `page '${pageId}' not found`);
  return entry.page;
}

async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser;
  log('launching chromium');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--mute-audio',
    ],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  browser.on('disconnected', () => {
    log('browser disconnected');
    browser = null;
    sessions.clear();
    pages.clear();
    sessionPages.clear();
  });
  return browser;
}

// ----- handlers --------------------------------------------------------------

async function handleSessionCreate(params = {}) {
  const b = await ensureBrowser();
  const ctx = await b.newContext({
    userAgent: params.user_agent,
    viewport: params.viewport ?? { width: 1280, height: 800 },
    locale: params.locale,
    storageState: params.storage_state,
    ignoreHTTPSErrors: !!params.ignore_https_errors,
  });
  const id = randomUUID();
  sessions.set(id, ctx);
  sessionPages.set(id, new Set());
  ctx.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  ctx.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
  log('session.create', id);
  return { session_id: id };
}

async function handleSessionClose(params = {}) {
  const sessionId = mustHave(params, 'session_id');
  const ctx = sessions.get(sessionId);
  if (!ctx) return { closed: false };
  // Drop tracked pages first.
  const ids = sessionPages.get(sessionId) ?? new Set();
  for (const pageId of ids) pages.delete(pageId);
  sessionPages.delete(sessionId);
  await ctx.close().catch((e) => log('session.close error', e));
  sessions.delete(sessionId);
  log('session.close', sessionId);
  return { closed: true };
}

function handleSessionList() {
  const out = [];
  for (const [sessionId, ids] of sessionPages.entries()) {
    out.push({ session_id: sessionId, pages: Array.from(ids) });
  }
  return { sessions: out };
}

async function handlePageGoto(params = {}) {
  const sessionId = mustHave(params, 'session_id');
  const url = mustHave(params, 'url');
  const ctx = sessions.get(sessionId);
  if (!ctx) throw new RpcError('not_found', `session '${sessionId}' not found`);
  const timeout = clampTimeout(params.timeout_ms);
  const waitUntil = params.wait_until ?? 'load';

  let pageEntry = params.page_id ? pages.get(params.page_id) : null;
  let pageId = params.page_id;
  if (!pageEntry) {
    const page = await ctx.newPage();
    pageId = randomUUID();
    pageEntry = { sessionId, page };
    pages.set(pageId, pageEntry);
    sessionPages.get(sessionId)?.add(pageId);
  }

  const response = await pageEntry.page.goto(url, { waitUntil, timeout });
  return {
    page_id: pageId,
    status: response ? response.status() : null,
    url,
    final_url: pageEntry.page.url(),
  };
}

async function handlePageRead(params = {}) {
  const pageId = mustHave(params, 'page_id');
  const page = getPage(pageId);
  const maxBytes = clampMaxBytes(params.max_bytes, MAX_HTML_BYTES);
  const html = await page.content();
  const bytes = Buffer.byteLength(html, 'utf8');
  const truncated = bytes > maxBytes;
  // Truncate UTF-8 safely by slicing on a code-point boundary.
  let body = html;
  if (truncated) body = sliceUtf8(html, maxBytes);
  const title = await page.title().catch(() => '');
  return {
    title,
    html: body,
    byte_length: Buffer.byteLength(body, 'utf8'),
    truncated,
    final_url: page.url(),
  };
}

function sliceUtf8(s, maxBytes) {
  // Walk forward until we cross maxBytes; back off to a code point start.
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
  return buf.slice(0, cut).toString('utf8');
}

async function handlePageScreenshot(params = {}) {
  const pageId = mustHave(params, 'page_id');
  const page = getPage(pageId);
  const fullPage = !!params.full_page;
  const format = params.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = format === 'jpeg' ? Math.min(100, Math.max(1, params.quality ?? 80)) : undefined;
  const maxBytes = clampMaxBytes(params.max_bytes, MAX_SCREENSHOT_BYTES);
  const savePath = typeof params.save_to_path === 'string' ? params.save_to_path : null;

  const opts = { type: format, fullPage, quality };
  if (savePath) opts.path = savePath;

  let buf;
  if (params.selector) {
    const locator = page.locator(params.selector);
    buf = await locator.screenshot(opts);
  } else {
    buf = await page.screenshot(opts);
  }

  if (savePath) {
    return { saved_to: savePath, byte_length: buf.length, format };
  }
  if (buf.length > maxBytes) {
    throw new RpcError('size_limit', `screenshot ${buf.length} bytes exceeds cap ${maxBytes}`);
  }
  const viewport = page.viewportSize() ?? { width: null, height: null };
  return {
    bytes_b64: buf.toString('base64'),
    byte_length: buf.length,
    format,
    width: viewport.width,
    height: viewport.height,
  };
}

async function handlePageClick(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const selector = mustHave(params, 'selector');
  await page.locator(selector).first().click({
    button: params.button ?? 'left',
    clickCount: params.click_count ?? 1,
    timeout: clampTimeout(params.timeout_ms),
    force: !!params.force,
  });
  return { clicked: true };
}

async function handlePageType(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const selector = mustHave(params, 'selector');
  const text = mustHave(params, 'text');
  const locator = page.locator(selector).first();
  if (params.clear_first) {
    await locator.fill('', { timeout: clampTimeout(params.timeout_ms) });
  }
  await locator.type(text, {
    delay: params.delay_ms ?? 0,
    timeout: clampTimeout(params.timeout_ms),
  });
  return { typed: true };
}

async function handlePageFill(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const selector = mustHave(params, 'selector');
  const value = mustHave(params, 'value');
  await page.locator(selector).first().fill(value, { timeout: clampTimeout(params.timeout_ms) });
  return { filled: true };
}

async function handlePageHover(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const selector = mustHave(params, 'selector');
  await page.locator(selector).first().hover({ timeout: clampTimeout(params.timeout_ms) });
  return { hovered: true };
}

async function handlePageScroll(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  if (params.selector) {
    await page.locator(params.selector).first().scrollIntoViewIfNeeded({
      timeout: clampTimeout(params.timeout_ms),
    });
    return { scrolled: 'selector' };
  }
  const direction = params.direction ?? 'bottom';
  await page.evaluate(([dir, x, y]) => {
    if (dir === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
    else if (dir === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    else if (dir === 'to' && typeof x === 'number' && typeof y === 'number') {
      window.scrollTo({ top: y, left: x, behavior: 'instant' });
    } else {
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'instant' });
    }
  }, [direction, params.x, params.y]);
  return { scrolled: direction };
}

async function handlePageWaitFor(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const timeout = clampTimeout(params.timeout_ms);
  if (params.selector) {
    await page.locator(params.selector).first().waitFor({
      state: params.state ?? 'visible',
      timeout,
    });
    return { waited: 'selector' };
  }
  if (params.load_state) {
    await page.waitForLoadState(params.load_state, { timeout });
    return { waited: params.load_state };
  }
  // Plain delay fallback (capped).
  const delayMs = Math.min(timeout, Number(params.delay_ms ?? 0));
  if (delayMs > 0) await page.waitForTimeout(delayMs);
  return { waited: 'delay' };
}

async function handlePageEval(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const expression = mustHave(params, 'expression');
  if (typeof expression !== 'string' || expression.length > 8192) {
    throw new RpcError('invalid_params', 'expression must be a string ≤ 8 KiB');
  }
  // Wrap in an IIFE so the agent can pass either an expression or a body.
  const wrapped = `(async () => { return (${expression}); })()`;
  const result = await page.evaluate(wrapped);
  // Best-effort safe serialization: anything not JSON-serializable becomes its String form.
  let value;
  try { value = JSON.parse(JSON.stringify(result)); }
  catch { value = String(result); }
  return { value };
}

async function handlePageExtract(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const selectors = mustHave(params, 'selectors');
  if (typeof selectors !== 'object' || Array.isArray(selectors)) {
    throw new RpcError('invalid_params', 'selectors must be an object');
  }
  const data = {};
  for (const [field, sel] of Object.entries(selectors)) {
    if (typeof sel !== 'string') { data[field] = null; continue; }
    try {
      const texts = await page.locator(sel).allTextContents();
      const trimmed = texts.map((t) => t.trim()).filter((t) => t.length > 0);
      data[field] = trimmed.length === 1 ? trimmed[0] : trimmed;
    } catch (e) {
      data[field] = { error: String(e?.message ?? e) };
    }
  }
  return { data };
}

async function handlePageCookies(params = {}) {
  const page = getPage(mustHave(params, 'page_id'));
  const action = params.action ?? 'get';
  const ctx = page.context();
  if (action === 'get') {
    return { cookies: await ctx.cookies() };
  }
  if (action === 'set') {
    const cookies = mustHave(params, 'cookies');
    await ctx.addCookies(cookies);
    return { set: cookies.length };
  }
  if (action === 'clear') {
    await ctx.clearCookies();
    return { cleared: true };
  }
  throw new RpcError('invalid_params', `unknown cookies action '${action}'`);
}

async function handlePageClose(params = {}) {
  const pageId = mustHave(params, 'page_id');
  const entry = pages.get(pageId);
  if (!entry) return { closed: false };
  await entry.page.close().catch(() => {});
  pages.delete(pageId);
  sessionPages.get(entry.sessionId)?.delete(pageId);
  return { closed: true };
}

async function handleShutdown() {
  log('shutdown requested');
  setTimeout(() => process.exit(0), 50);
  // Best-effort cleanup.
  try {
    for (const ctx of sessions.values()) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  } catch {}
  return { ok: true };
}

function handlePing() {
  return { pong: true, sessions: sessions.size, pages: pages.size };
}

// ----- dispatch --------------------------------------------------------------

const handlers = {
  'ping': handlePing,
  'session.create': handleSessionCreate,
  'session.close': handleSessionClose,
  'session.list': handleSessionList,
  'page.goto': handlePageGoto,
  'page.read': handlePageRead,
  'page.screenshot': handlePageScreenshot,
  'page.click': handlePageClick,
  'page.type': handlePageType,
  'page.fill': handlePageFill,
  'page.hover': handlePageHover,
  'page.scroll': handlePageScroll,
  'page.wait_for': handlePageWaitFor,
  'page.eval': handlePageEval,
  'page.extract': handlePageExtract,
  'page.cookies': handlePageCookies,
  'page.close': handlePageClose,
  'shutdown': handleShutdown,
};

async function dispatch(req) {
  const { id, method, params } = req;
  const handler = handlers[method];
  if (!handler) {
    return { id, ok: false, error: { code: 'unknown_method', message: `unknown method '${method}'` } };
  }
  try {
    const result = await handler(params);
    return { id, ok: true, result };
  } catch (e) {
    const code = e instanceof RpcError ? e.code : classify(e);
    return { id, ok: false, error: { code, message: String(e?.message ?? e) } };
  }
}

function classify(e) {
  const msg = String(e?.message ?? e).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  if (msg.includes('not found') || msg.includes('no element')) return 'not_found';
  if (msg.includes('net::') || msg.includes('connection')) return 'network';
  return 'execution_failed';
}

function send(res) {
  process.stdout.write(JSON.stringify(res) + '\n');
}

// ----- stdin loop ------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    send({ id: null, ok: false, error: { code: 'parse_error', message: String(e) } });
    return;
  }
  // Run handler async; responses may be reordered relative to requests, but
  // each carries the original id so the Rust client can correlate.
  dispatch(req).then(send).catch((e) => {
    send({ id: req?.id ?? null, ok: false, error: { code: 'internal', message: String(e?.message ?? e) } });
  });
});

rl.on('close', () => {
  log('stdin closed, exiting');
  handleShutdown().finally(() => process.exit(0));
});

process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

log('ready');
