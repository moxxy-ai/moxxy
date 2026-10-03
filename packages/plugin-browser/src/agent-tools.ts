import { resolve as resolvePath } from 'node:path';
import { MoxxyError, defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { browserSidecarCall, type BrowserSessionDeps } from './browser-session.js';
import { bridgeAddressFromEnv } from './bridge-client.js';
import { assertPublicUrl, SsrfBlockedError } from './ssrf-guard.js';
import { ALLOW_SITE_TOOL, siteOf, sitesFromLog, type SiteGrant } from './site-access.js';

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

type Call = (method: string, params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

/**
 * How the tools reach the browser. On the desktop each call names its turn: the
 * user can take the browser over, which stops the turn that was driving it, and
 * their next message — a new turn — is what hands it back. It also carries the
 * sites the conversation allowed, which the desktop checks against the page the
 * action would land on.
 */
function caller(deps: BrowserSessionDeps | undefined, desktop: boolean): Call {
  return (method, params, ctx) =>
    browserSidecarCall(
      method,
      desktop ? { ...params, turn_id: ctx.turnId, sites: sitesFromLog(ctx.log) } : params,
      deps,
      ctx.signal,
    );
}

/**
 * Name the sites already allowed on every read of the page. Without it the
 * model, having lost track, asks again — and each ask is a prompt to the user.
 */
function withAllowedSites(read: unknown, sites: readonly string[]): unknown {
  if (typeof read !== 'object' || read === null || typeof (read as { text?: unknown }).text !== 'string') return read;
  const line = sites.length
    ? `- Sites you may act on: ${sites.join(', ')} (already allowed — do not ask again)`
    : `- Sites you may act on: none yet — call ${ALLOW_SITE_TOOL} before the first action on a site`;
  return { ...read, text: `${(read as { text: string }).text}\n${line}` };
}

/** Capabilities shared by the acting tools; reading declares less. */
const ACT_ISOLATION = {
  capabilities: {
    subprocess: true,
    net: { mode: 'any' as const },
    timeMs: 60_000,
  },
};

export interface AgentToolsOptions {
  /**
   * Whether the page is the desktop's own view, driven through its bridge.
   * There the backend can answer dialogs, pick from native lists, scroll, hover
   * and wait, and every press reports what it set off; the headless sidecar
   * cannot, so it gets the original set and the original descriptions.
   */
  readonly desktop?: boolean;
}

export function buildAgentTools(deps?: BrowserSessionDeps, opts: AgentToolsOptions = {}): ReadonlyArray<ToolDef> {
  const desktop = opts.desktop ?? (bridgeAddressFromEnv() !== null && !deps?.spawnFn);
  const call = caller(deps, desktop);
  // On the desktop the person allows a site once (browser_allow_site) and the
  // desktop refuses actions anywhere else, so asking per call would only
  // interrupt; the headless sidecar has no such gate and keeps every prompt.
  const acting = { action: desktop ? 'allow' : 'prompt' } as const;

  const snapshot = defineTool({
    name: 'browser_snapshot',
    icon: 'search',
    description:
      'Read the current page as an accessibility tree: every interactive element with a [uid] you can act on, ' +
      'plus the URL, the title and the list of open tabs. Call this before acting, and again after any action ' +
      'that changes the page. Prefer this over a screenshot: it is cheaper and it is the only form you can ' +
      'click. After the first read of a tab you get only what changed since it — a uid keeps meaning the same ' +
      'element, so everything not listed is still as you last saw it. Ask for full: true when the changes alone ' +
      'are not enough to work from.',
    inputSchema: z.object({
      tab_id: tabId,
      full: z
        .boolean()
        .optional()
        .describe(
          'Send the whole tree instead of only what changed. Costs far more on a large page — use it when you ' +
            'have lost your bearings, not by default.',
        ),
    }),
    // Reading a page the user already told the agent to visit is not a
    // decision worth interrupting them for; the acting tools are.
    permission: { action: 'allow' },
    compact: { verb: 'Reading', noun: { one: 'page', other: 'pages' }, previewKey: 'tab_id' },
    isolation: { capabilities: { subprocess: true, net: { mode: 'any' as const }, timeMs: 60_000 } },
    handler: async ({ tab_id, full }, ctx) => {
      const read = await call('snapshot', { tab_id, full }, ctx);
      return desktop ? withAllowedSites(read, sitesFromLog(ctx.log)) : read;
    },
  });

  const click = defineTool({
    name: 'browser_click',
    icon: 'globe',
    description: desktop
      ? 'Click an element by the [uid] shown in the latest browser_snapshot. The tab comes to the front, the ' +
        'element is scrolled into view, and the click is refused — with the reason — if the element is disabled ' +
        'or something covers it (a banner, a dialog); clear what is in the way rather than retrying. It returns ' +
        'once the page has settled, saying what the click set off: navigated (and the new url), a dialog ' +
        '(an alert is accepted and quoted; a confirm or prompt stays open for browser_dialog), or a tab the page ' +
        'opened (its tab_id). Fails if the page navigated since that snapshot — take a fresh one.'
      : 'Click an element by the [uid] shown in the latest browser_snapshot. Fails if the page navigated since ' +
        'that snapshot — take a fresh one rather than retrying the old uid.',
    inputSchema: z.object({ uid: z.string().min(1), element, tab_id: tabId }),
    permission: acting,
    compact: { verb: 'Clicking', noun: { one: 'element', other: 'elements' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ uid, tab_id }, ctx) => call('act', { action: 'click', uid, tab_id }, ctx),
  });

  const typeFields = { uid: z.string().min(1), element, text: z.string(), tab_id: tabId };
  const type = desktop
    ? defineTool({
        name: 'browser_type',
        icon: 'edit',
        description:
          'Put text into a field by [uid], replacing whatever it held (an empty text clears it). A field that ' +
          'already says exactly this is left alone. Pass submit: true to press Enter afterwards — the usual way to ' +
          'run a search. If the field formats what it is given (a phone number, a date), the result says what it ' +
          'now shows. Never use this for a password or one-time code — ask the user to enter those themselves.',
        inputSchema: z.object({
          ...typeFields,
          submit: z.boolean().optional().describe('Press Enter after typing, e.g. to run a search.'),
        }),
        permission: acting,
        compact: { verb: 'Typing into', noun: { one: 'field', other: 'fields' }, previewKey: 'element' },
        isolation: ACT_ISOLATION,
        handler: ({ uid, text, submit, tab_id }, ctx) =>
          call('act', { action: 'type', uid, text, ...(submit ? { submit: true } : {}), tab_id }, ctx),
      })
    : defineTool({
        name: 'browser_type',
        icon: 'edit',
        description:
          'Focus an element by [uid] and type into it. Use browser_snapshot first to find the field. ' +
          'Never use this for a password or one-time code — ask the user to enter those themselves.',
        inputSchema: z.object(typeFields),
        permission: acting,
        compact: { verb: 'Typing into', noun: { one: 'field', other: 'fields' }, previewKey: 'element' },
        isolation: ACT_ISOLATION,
        handler: ({ uid, text, tab_id }, ctx) => call('act', { action: 'type', uid, text, tab_id }, ctx),
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
    permission: acting,
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
      return call('goto', { url, tab_id }, ctx);
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
    permission: acting,
    compact: { verb: 'Managing', noun: { one: 'tab', other: 'tabs' }, previewKey: 'action' },
    isolation: ACT_ISOLATION,
    handler: ({ action, tab_id, url }, ctx) => call('tabs', { action, tab_id, url }, ctx),
  });

  const capture = defineTool({
    name: 'browser_capture',
    icon: 'file',
    description:
      'Take a picture of the page — the last resort, after browser_snapshot. Use it when the accessibility ' +
      'tree is empty where something is clearly visible (a <canvas> app, a chart, a rendered document). ' +
      'Pass a uid to crop to that element, which is far cheaper than a whole viewport and is usually the ' +
      'part that was actually in question.' +
      (desktop
        ? ' Every picture comes back named — a view id and its size — and browser_point acts on what it shows, ' +
          'in its pixels; a crop to a canvas is the cheap way to work on one.'
        : ''),
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
        clip = await call('box', { uid, tab_id }, ctx);
      }
      return call('capture', { tab_id, ...(clip ? { clip } : {}) }, ctx);
    },
  });

  const key = defineTool({
    name: 'browser_key',
    icon: 'globe',
    description: desktop
      ? 'Press a key on the page. Use it for the things a click and a typed string cannot do: submitting ' +
        'with Enter, dismissing with Escape, moving with Tab or the arrows. Combine modifiers with "+", e.g. ' +
        '"Shift+Tab", "Meta+a". browser_type already replaces a field\'s text, so there is no need to clear one ' +
        'first. The key goes wherever the page has focus, so browser_click the field first — otherwise it lands ' +
        'on whatever was focused before. Returns once the page settles, saying whether it navigated.'
      : 'Press a key on the page. Use it for the things a click and a typed string cannot do: submitting ' +
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
    permission: acting,
    compact: { verb: 'Pressing', noun: { one: 'key', other: 'keys' }, previewKey: 'key' },
    isolation: ACT_ISOLATION,
    handler: ({ key: k, tab_id }, ctx) => call('key', { key: k, tab_id }, ctx),
  });

  /**
   * One step of a batch. Deliberately the same primitives the single tools
   * expose — a batch is a way to pay for one read instead of five, not a second
   * vocabulary that could drift from the first.
   */
  const commonSteps = [
    z.object({ kind: z.literal('click'), uid: z.string().min(1) }),
    z.object({ kind: z.literal('key'), key: z.string().min(1) }),
    z.object({ kind: z.literal('navigate'), url: z.string().url() }),
    z.object({ kind: z.literal('history'), action: z.enum(['back', 'forward', 'reload']) }),
  ] as const;
  const step = desktop
    ? z.discriminatedUnion('kind', [
        ...commonSteps,
        z.object({ kind: z.literal('type'), uid: z.string().min(1), text: z.string(), submit: z.boolean().optional() }),
        z.object({ kind: z.literal('select'), uid: z.string().min(1), option: z.string().min(1) }),
      ])
    : z.discriminatedUnion('kind', [...commonSteps, z.object({ kind: z.literal('type'), uid: z.string().min(1), text: z.string() })]);

  const batch = defineTool({
    name: 'browser_batch',
    icon: 'globe',
    description:
      'Do several things to a page and read it once at the end, instead of reading after every one. This is ' +
      'the cheap way to work: a read of a large page costs thousands of tokens, so filling a form as five ' +
      'separate calls pays for five of them. Use it whenever you already know the next few steps — fill these ' +
      'fields, press Enter, read the result. Steps run in order and stop at the first failure, so a sequence ' +
      'never carries on against a page that did not do what you expected. The uids must come from your latest ' +
      'snapshot.',
    inputSchema: z.object({
      element: z
        .string()
        .min(1)
        .describe('What this sequence does, in a few words — shown to the user when approving all of it at once.'),
      steps: z.array(step).min(1).max(20).describe('In order. The page is read once, after the last one.'),
      tab_id: tabId,
    }),
    permission: acting,
    compact: { verb: 'Doing', noun: { one: 'sequence', other: 'sequences' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    async handler({ steps, tab_id }, ctx) {
      for (const [i, s] of steps.entries()) {
        try {
          if (s.kind === 'click') {
            await call('act', { action: 'click', uid: s.uid, tab_id }, ctx);
          } else if (s.kind === 'type') {
            const submit = 'submit' in s && s.submit === true;
            await call('act', { action: 'type', uid: s.uid, text: s.text, ...(submit ? { submit: true } : {}), tab_id }, ctx);
          } else if (s.kind === 'select') {
            await call('select', { uid: s.uid, option: s.option, tab_id }, ctx);
          } else if (s.kind === 'key') {
            await call('key', { key: s.key, tab_id }, ctx);
          } else if (s.kind === 'navigate') {
            await assertPublicUrl(s.url, 'browser_batch', { failClosed: true });
            await call('goto', { url: s.url, tab_id }, ctx);
          } else {
            await call(s.action, { tab_id }, ctx);
          }
        } catch (err) {
          // Name the step. "It failed" against a five-step sequence tells the
          // model nothing about what the page is now in the middle of.
          const why = err instanceof Error ? err.message : String(err);
          throw new MoxxyError({ code: 'INTERNAL', message: `step ${i + 1} (${s.kind}) failed: ${why}` });
        }
      }
      return call('snapshot', { tab_id }, ctx).then((snap) => ({
        ...(snap as object),
        ran: steps.length,
      }));
    },
  });

  const back = defineTool({
    name: 'browser_history',
    icon: 'globe',
    description:
      'Go back, go forward, or reload the tab. Uids from the previous snapshot stop being valid, so take a ' +
      'fresh browser_snapshot afterwards.',
    inputSchema: z.object({ action: z.enum(['back', 'forward', 'reload']), tab_id: tabId }),
    permission: acting,
    compact: { verb: 'Navigating', noun: { one: 'page', other: 'pages' }, previewKey: 'action' },
    isolation: ACT_ISOLATION,
    handler: ({ action, tab_id }, ctx) => call(action, { tab_id }, ctx),
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
    handler: ({ reason, tab_id }, ctx) => call('await_human', { reason, tab_id }, ctx),
  });

  const tools: ToolDef[] = [snapshot, click, type, navigate, tabs, capture, key, batch, back, awaitHuman];
  if (desktop) tools.push(...buildDesktopTools(call));
  return tools;
}

/** Tools only the desktop's backend can serve; see AgentToolsOptions.desktop. */
function buildDesktopTools(call: Call): ToolDef[] {
  const select = defineTool({
    name: 'browser_select',
    icon: 'globe',
    description:
      'Choose an option in a list (a native <select>, shown as a combobox) by its visible label or its value. ' +
      'Clicking such a list and pressing arrows does not work — its options are drawn outside the page. If the ' +
      'option is not there, the error lists the ones that are. A custom dropdown that is not a <select> is ' +
      'clicked open instead, then its option clicked.',
    inputSchema: z.object({
      uid: z.string().min(1),
      option: z.string().min(1).describe('The option to choose, by its label as shown (or its value).'),
      element,
      tab_id: tabId,
    }),
    permission: { action: 'allow' },
    compact: { verb: 'Choosing in', noun: { one: 'list', other: 'lists' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ uid, option, tab_id }, ctx) => call('select', { uid, option, tab_id }, ctx),
  });

  const scroll = defineTool({
    name: 'browser_scroll',
    icon: 'globe',
    description:
      'Scroll the page — or, with a uid, the scrollable part that element sits in — by screens. Use it to reach ' +
      'what is below the fold or to load the next part of a long list; clicking and typing already scroll to ' +
      'their element on their own. Says whether anything moved, so "scroll again" is never a guess.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down']),
      screens: z.number().min(0.25).max(10).optional().describe('How far, in screens. Default 1.'),
      uid: blankAsAbsent(z.string().min(1)).describe('Scroll the area this element is in, instead of the page.'),
      tab_id: tabId,
    }),
    permission: { action: 'allow' },
    compact: { verb: 'Scrolling', noun: { one: 'page', other: 'pages' }, previewKey: 'direction' },
    isolation: ACT_ISOLATION,
    handler: ({ direction, screens, uid, tab_id }, ctx) =>
      call('scroll', { direction, ...(screens !== undefined ? { screens } : {}), ...(uid ? { uid } : {}), tab_id }, ctx),
  });

  const hover = defineTool({
    name: 'browser_hover',
    icon: 'globe',
    description:
      'Move the pointer over an element by [uid] without pressing it — for menus that open on hover and ' +
      'tooltips. Read the page afterwards to see what appeared.',
    inputSchema: z.object({ uid: z.string().min(1), element, tab_id: tabId }),
    permission: { action: 'allow' },
    compact: { verb: 'Pointing at', noun: { one: 'element', other: 'elements' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ uid, tab_id }, ctx) => call('act', { action: 'hover', uid, tab_id }, ctx),
  });

  const wait = defineTool({
    name: 'browser_wait',
    icon: 'globe',
    description:
      'Wait until the page shows a text (or, with gone: true, stops showing it) — for an answer that takes a ' +
      'while: a search still running, a file uploading, a spinner. Every action already waits for the page to ' +
      'settle, so use this only for something slower. met: false means it had not happened by the deadline.',
    inputSchema: z.object({
      text: z.string().min(1).describe('Text to wait for, as it will appear on the page.'),
      gone: z.boolean().optional().describe('Wait for the text to disappear instead.'),
      timeout_ms: z.number().int().min(0).max(30_000).optional().describe('How long at most. Default 10000.'),
      tab_id: tabId,
    }),
    permission: { action: 'allow' },
    compact: { verb: 'Waiting for', noun: { one: 'page', other: 'pages' }, previewKey: 'text' },
    isolation: { capabilities: { subprocess: true, net: { mode: 'any' as const }, timeMs: 60_000 } },
    handler: ({ text, gone, timeout_ms, tab_id }, ctx) =>
      call(
        'wait',
        { text, ...(gone ? { gone: true } : {}), ...(timeout_ms !== undefined ? { timeoutMs: timeout_ms } : {}), tab_id },
        ctx,
      ),
  });

  const dialog = defineTool({
    name: 'browser_dialog',
    icon: 'globe',
    description:
      'Answer the dialog a page opened — a confirm ("Are you sure?") or a prompt asking for text. Until it is ' +
      'answered the page is frozen and every other action on that tab fails. accept: true presses OK, false ' +
      'presses Cancel; text is what a prompt is given. An alert needs no answer: clicks accept those on their ' +
      'own and quote them. If the dialog asks something only the user can decide, ask them first.',
    inputSchema: z.object({
      accept: z.boolean(),
      text: blankAsAbsent(z.string()).describe('For a prompt dialog: the text to give it.'),
      element: z.string().min(1).describe('What the dialog asks and what this answer does — shown when approving.'),
      tab_id: tabId,
    }),
    permission: { action: 'prompt' },
    compact: { verb: 'Answering', noun: { one: 'dialog', other: 'dialogs' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ accept, text, tab_id }, ctx) =>
      call('dialog', { accept, ...(text !== undefined ? { text } : {}), tab_id }, ctx),
  });

  const allowSite = defineTool({
    name: ALLOW_SITE_TOOL,
    icon: 'lock',
    description:
      'Ask the user to let you act on a site — click, type, open its pages — for the rest of this conversation. ' +
      'Actions on a site nobody allowed are refused, so call this before the first action on a new site, in the ' +
      'same response as that action. The user is asked once for the whole site (it covers its subdomains); ' +
      'reading a page never needs it. Say plainly in `reason` what you will do there.',
    inputSchema: z.object({
      site: z.string().min(1).describe('The site, e.g. "canva.com", or any URL on it.'),
      reason: z.string().min(1).describe('What you will do on the site, in one sentence — shown to the user.'),
    }),
    permission: { action: 'prompt' },
    compact: { verb: 'Allowing', noun: { one: 'site', other: 'sites' }, previewKey: 'site' },
    handler: async ({ site }): Promise<SiteGrant> => {
      const allowed = siteOf(site);
      if (!allowed) throw new MoxxyError({ code: 'INTERNAL', message: `"${site}" is not a web site` });
      return { kind: 'browser_site', site: allowed };
    },
  });

  const point = defineTool({
    name: 'browser_point',
    icon: 'globe',
    description:
      'Act at a place in your latest picture of the page (browser_capture, whole or cropped) — for what the ' +
      'accessibility tree cannot name: a canvas, a drawing app, a map. x and y are pixels of that picture, ' +
      'origin top left; view is its id. click / double_click / right_click / move press or hover there; drag ' +
      'holds the button from (x, y) through every point of path and lets go at the last; scroll turns the ' +
      'wheel there (direction, screens); type types text wherever the keyboard focus is and key presses one key ' +
      '(e.g. "r" to pick a drawing tool, "Escape") — neither takes x, y. Refused, with nothing done, if the page navigated, ' +
      'scrolled, or looks different at that place since the picture. Each call answers with a fresh picture, ' +
      'which is the one to point at next. Prefer uids whenever the snapshot has the element.',
    inputSchema: z.object({
      action: z.enum(['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key']),
      x: z.number().optional().describe('Pixels from the left of the picture. Not for type or key.'),
      y: z.number().optional().describe('Pixels from the top of the picture. Not for type or key.'),
      path: z
        .array(z.array(z.number()).length(2))
        .max(50)
        .optional()
        .describe('For drag: [x, y] points to pass through after (x, y); the last is where it lets go.'),
      direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('For scroll. Default down.'),
      screens: z.number().min(0.25).max(10).optional().describe('For scroll: how far, in screens. Default 1.'),
      text: z.string().min(1).optional().describe('For type: the text to type.'),
      key: z.string().min(1).optional().describe('For key: the key, e.g. "r", "Escape", "Meta+z".'),
      view: z.string().min(1).describe('The id of the picture the coordinates come from, e.g. "v3".'),
      element: z.string().min(1).describe('What is at that place and what this does, in a few words — shown to the user.'),
      tab_id: tabId,
    }),
    permission: { action: 'allow' },
    compact: { verb: 'Pointing at', noun: { one: 'place', other: 'places' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ action, x, y, path, direction, screens, text, key, view, tab_id }, ctx) =>
      call('point', { action, x, y, path, direction, screens, text, key, view, tab_id }, ctx),
  });

  const upload = defineTool({
    name: 'browser_upload',
    icon: 'file',
    description:
      'Give a page\'s file field files from this computer — what choosing them in the file dialog does. uid is ' +
      'the file input, or the button or label that opens it. Paths are on this computer; a relative path is ' +
      'taken from the working directory. The user is asked every time, since the files leave the computer. ' +
      'Never click the button to open the system file dialog: you cannot answer it.',
    inputSchema: z.object({
      uid: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1).max(20),
      element: z.string().min(1).describe('What the field is for — shown to the user when approving.'),
      tab_id: tabId,
    }),
    permission: { action: 'prompt' },
    compact: { verb: 'Uploading to', noun: { one: 'field', other: 'fields' }, previewKey: 'element' },
    isolation: ACT_ISOLATION,
    handler: ({ uid, paths, tab_id }, ctx) =>
      call('upload', { uid, paths: paths.map((path) => resolvePath(ctx.cwd, path)), tab_id }, ctx),
  });

  return [select, scroll, hover, wait, dialog, allowSite, point, upload];
}
