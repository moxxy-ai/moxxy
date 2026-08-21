import { MoxxyError, defineTool, z, type ToolDef } from '@moxxy/sdk';
import { browserSidecarCall, type BrowserSessionDeps } from './browser-session.js';
import { assertPublicUrl, SsrfBlockedError } from './ssrf-guard.js';

/**
 * The agent's view of the browser: read the page as structured text, act on
 * what was read, move between tabs.
 *
 * These replace guessing. The old surface gave the model `innerText` (a wall
 * of prose with nothing to click) or a screenshot (pixels with nothing to
 * click), and then asked it to invent a CSS selector. Here every actionable
 * element arrives with a `uid`, and acting means naming that uid — so a wrong
 * click is a failed lookup rather than a plausible-looking mistake nobody
 * notices until three steps later.
 *
 * Tools are separate rather than one dispatcher with an `action` union because
 * they carry different permissions: reading a page is not the same decision as
 * typing into one, and the permission engine grades per tool name.
 */

/**
 * An optional string the model is allowed to send as `""`.
 *
 * Models routinely fill in every field a schema declares, and on an optional
 * field an empty string means "I have nothing for this" — not "the empty
 * string". Read literally it fails `.url()` or `.min(1)` and the whole call is
 * refused before it reaches the browser. Observed live: openai-codex called
 * browser_tabs with `{action:"list", tab_id:"", url:""}`, got back
 * "url: Invalid url", and went off looking for some other browser to use.
 */
function blankAsAbsent<S extends z.ZodTypeAny>(schema: S) {
  return z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
}

/** Shared shape: every call may name a tab; omitting it means the active one. */
const tabId = blankAsAbsent(z.string()).describe(
  'Tab to act on, as returned by browser_snapshot or browser_tabs — they look like "t1". ' +
    'Omit for whichever tab is in front; never invent one.',
);

/**
 * A short human-readable description of the element, e.g. "Zaloguj button".
 * Required, and deliberately so: it is what an approval prompt and the audit
 * trail show. A uid alone tells the person being asked nothing.
 */
const element = z.string().min(1).describe('What the element is, in a few words — shown to the user when approving.');

async function call(
  method: string,
  params: Record<string, unknown>,
  deps: BrowserSessionDeps | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  return browserSidecarCall(method, params, deps, signal);
}

/** Capabilities shared by the acting tools; reading declares less. */
const ACT_ISOLATION = {
  capabilities: {
    subprocess: true,
    net: { mode: 'any' as const },
    timeMs: 60_000,
  },
};

export function buildAgentTools(deps?: BrowserSessionDeps): ReadonlyArray<ToolDef> {
  const snapshot = defineTool({
    name: 'browser_snapshot',
    icon: 'search',
    description:
      'Read the current page as an accessibility tree: every interactive element with a [uid] you can act on, ' +
      'plus the URL, the title and the list of open tabs. Call this before acting, and again after any action ' +
      'that changes the page — uids are only valid for the snapshot they came from. Prefer this over a ' +
      'screenshot: it is cheaper and it is the only form you can click.',
    inputSchema: z.object({ tab_id: tabId }),
    // Reading a page the user already told the agent to visit is not a
    // decision worth interrupting them for; the acting tools are.
    permission: { action: 'allow' },
    compact: { verb: 'Reading', noun: { one: 'page', other: 'pages' }, previewKey: 'tab_id' },
    isolation: { capabilities: { subprocess: true, net: { mode: 'any' as const }, timeMs: 60_000 } },
    handler: ({ tab_id }, ctx) => call('snapshot', { tab_id }, deps, ctx.signal),
  });

  const click = defineTool({
    name: 'browser_click',
    icon: 'globe',
    description:
      'Click an element by the [uid] shown in the latest browser_snapshot. Fails if the page navigated since ' +
      'that snapshot — take a fresh one rather than retrying the old uid.',
    inputSchema: z.object({ uid: z.string().min(1), element, tab_id: tabId }),
    permission: { action: 'prompt' },
    compact: { verb: 'Clicking', noun: { one: 'element', other: 'elements' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ uid, tab_id }, ctx) => call('act', { action: 'click', uid, tab_id }, deps, ctx.signal),
  });

  const type = defineTool({
    name: 'browser_type',
    icon: 'edit',
    description:
      'Focus an element by [uid] and type into it. Use browser_snapshot first to find the field. ' +
      'Never use this for a password or one-time code — ask the user to enter those themselves.',
    inputSchema: z.object({ uid: z.string().min(1), element, text: z.string(), tab_id: tabId }),
    permission: { action: 'prompt' },
    compact: { verb: 'Typing into', noun: { one: 'field', other: 'fields' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ uid, text, tab_id }, ctx) => call('act', { action: 'type', uid, text, tab_id }, deps, ctx.signal),
  });

  const navigate = defineTool({
    name: 'browser_navigate',
    icon: 'globe',
    description:
      'Open a URL in a tab. Restricted to public http(s) origins — loopback, private, link-local and metadata ' +
      'addresses are refused.',
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .refine((u) => /^https?:\/\//i.test(u), 'only http(s) URLs allowed'),
      tab_id: tabId,
    }),
    permission: { action: 'prompt' },
    compact: { verb: 'Opening', noun: { one: 'page', other: 'pages' }, previewKey: 'url' },
    isolation: ACT_ISOLATION,
    async handler({ url, tab_id }, ctx) {
      // Same guard as web_fetch and browser_session, run here so a blocked URL
      // never reaches the sidecar (which re-checks it anyway — it is a separate
      // process and must not trust its caller).
      try {
        await assertPublicUrl(url, 'browser_navigate', { failClosed: true });
      } catch (err) {
        if (err instanceof SsrfBlockedError) throw new MoxxyError({ code: 'INTERNAL', message: err.message });
        throw err;
      }
      return call('goto', { url, tab_id }, deps, ctx.signal);
    },
  });

  const tabs = defineTool({
    name: 'browser_tabs',
    icon: 'globe',
    description:
      'List, open, switch or close tabs. Every other browser tool takes the tab_id these return, so a task ' +
      'spanning several pages keeps them apart instead of relying on which one happens to be in front.',
    inputSchema: z.object({
      action: z.enum(['list', 'new', 'select', 'close']),
      tab_id: tabId,
      url: blankAsAbsent(z.string().url()).describe(
        'For action "new" only: the page to open in the new tab. Leave it out for the other actions.',
      ),
    }),
    permission: { action: 'prompt' },
    compact: { verb: 'Managing', noun: { one: 'tab', other: 'tabs' }, previewKey: 'action' },
    isolation: ACT_ISOLATION,
    handler: ({ action, tab_id, url }, ctx) => call('tabs', { action, tab_id, url }, deps, ctx.signal),
  });

  const capture = defineTool({
    name: 'browser_capture',
    icon: 'file',
    description:
      'Take a picture of the page — the last resort, after browser_snapshot. Use it when the accessibility ' +
      'tree is empty where something is clearly visible (a <canvas> app, a chart, a rendered document). ' +
      'Pass a uid to crop to that element, which is far cheaper than a whole viewport and is usually the ' +
      'part that was actually in question.',
    inputSchema: z.object({
      uid: blankAsAbsent(z.string().min(1)).describe('Crop to this element from the last snapshot.'),
      tab_id: tabId,
    }),
    permission: { action: 'allow' },
    compact: { verb: 'Capturing', noun: { one: 'view', other: 'views' }, previewKey: 'uid' },
    isolation: { capabilities: { subprocess: true, net: { mode: 'any' as const }, timeMs: 60_000 } },
    async handler({ uid, tab_id }, ctx) {
      // Cropping needs the element's box, which only the backend can resolve —
      // ask for it first, then capture just that rectangle.
      let clip: unknown;
      if (uid) {
        clip = await call('box', { uid, tab_id }, deps, ctx.signal);
      }
      return call('capture', { tab_id, ...(clip ? { clip } : {}) }, deps, ctx.signal);
    },
  });

  const key = defineTool({
    name: 'browser_key',
    icon: 'globe',
    description:
      'Press a key on the page. Use it for the things a click and a typed string cannot do: submitting ' +
      'with Enter, dismissing with Escape, moving between fields with Tab, and clearing a field that ' +
      'already has something in it with "Meta+a" then "Backspace" before typing over it. Combine ' +
      'modifiers with "+", e.g. "Shift+Tab", "Meta+a". ' +
      'The key goes wherever the page has focus, so browser_click the field first — otherwise it lands ' +
      'on whatever was focused before, which is rarely what you meant.',
    inputSchema: z.object({
      key: z
        .string()
        .min(1)
        .describe('Named as a keyboard event names it: Enter, Escape, Tab, ArrowDown, Meta+a, Shift+Tab.'),
      element: z
        .string()
        .min(1)
        .describe('What has focus and what this key is meant to do — shown to the user when approving.'),
      tab_id: tabId,
    }),
    permission: { action: 'prompt' },
    compact: { verb: 'Pressing', noun: { one: 'key', other: 'keys' }, previewKey: 'key' },
    isolation: ACT_ISOLATION,
    handler: ({ key: k, tab_id }, ctx) => call('key', { key: k, tab_id }, deps, ctx.signal),
  });

  const back = defineTool({
    name: 'browser_history',
    icon: 'globe',
    description:
      'Go back, go forward, or reload the tab. Uids from the previous snapshot stop being valid, so take a ' +
      'fresh browser_snapshot afterwards.',
    inputSchema: z.object({ action: z.enum(['back', 'forward', 'reload']), tab_id: tabId }),
    permission: { action: 'prompt' },
    compact: { verb: 'Navigating', noun: { one: 'page', other: 'pages' }, previewKey: 'action' },
    isolation: ACT_ISOLATION,
    handler: ({ action, tab_id }, ctx) => call(action, { tab_id }, deps, ctx.signal),
  });

  const awaitHuman = defineTool({
    name: 'browser_await_human',
    icon: 'lock',
    description:
      'Stop and hand the browser to the user, then continue once they say they are done. Use this the moment ' +
      'a page needs something you must not do yourself: signing in, a one-time code, a consent or payment ' +
      'screen, a CAPTCHA. Say plainly in `reason` what they should do. ' +
      'You are NOT reading the page while this is pending, and you must never ask the user to tell you a ' +
      'password or code — they type it themselves. The result reports whether they finished; take a fresh ' +
      'browser_snapshot afterwards and confirm from the page that it worked before carrying on.',
    inputSchema: z.object({
      reason: z.string().min(1).describe('What the user should do, in one plain sentence.'),
      tab_id: tabId,
    }),
    // Reaching a login wall is the agent doing what it was asked to do, and the
    // user is about to be interrupted by the pane anyway. A second prompt on top
    // of that is noise.
    permission: { action: 'allow' },
    compact: { verb: 'Waiting for', noun: { one: 'you', other: 'you' }, previewKey: 'reason' },
    isolation: { capabilities: { subprocess: true, net: { mode: 'any' as const }, timeMs: 15 * 60_000 } },
    handler: ({ reason, tab_id }, ctx) => call('await_human', { reason, tab_id }, deps, ctx.signal),
  });

  return [snapshot, click, type, navigate, tabs, capture, key, back, awaitHuman];
}
