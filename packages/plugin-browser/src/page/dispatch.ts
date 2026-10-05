import { siteAllows, siteRefusal } from '../site-access.js';
import type { BrowserHost, HostReply, PointAction, PointParams } from './host.js';

/**
 * The wire methods the agent's browser tools speak, answered by a `BrowserHost`.
 *
 * One table for both backends: the desktop's bridge hands every call from the
 * runner here, and so does the headless sidecar for the methods it shares with
 * the desktop. Same names, same shapes — which is what lets one set of tools
 * serve either backend, and a fix to how a press works land on both.
 */

/** Methods that change the page or what the pane shows; refused while the person has the browser. */
const ACTING = new Set([
  'act', 'dialog', 'select', 'scroll', 'goto', 'back', 'forward', 'reload', 'click', 'fill', 'key', 'eval', 'point', 'upload',
]);

const POINT_ACTIONS = new Set<PointAction>(['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key']);
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

function isPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export interface HostDispatchOptions {
  /** Close a tab the agent asked to close; the desktop forgets it and the pane tears its view down. */
  readonly closeTab?: (tabId: string) => Promise<void> | void;
}

export async function dispatchToHost(
  host: BrowserHost,
  method: string,
  params: Record<string, unknown>,
  opts: HostDispatchOptions = {},
): Promise<HostReply> {
  // An empty string is a model filling in a field it has nothing for, not a
  // tab named "". Treat it as absent.
  const named = typeof params.tab_id === 'string' && params.tab_id ? params.tab_id : undefined;
  // Naming a tab is how the agent moves its own aim. Nothing the person does
  // in the pane touches it — see BrowserHost.agentTarget.
  if (named) host.noteAgentTab(named);
  const tabId = named ?? host.agentTarget();
  if (typeof params.turn_id === 'string' && params.turn_id) host.noteAgentTurn(params.turn_id);
  // While the person has the browser the agent may look, not touch.
  if (ACTING.has(method) || (method === 'tabs' && String(params.action ?? 'list') !== 'list')) {
    const refusal = host.agentRefusal();
    if (refusal) return { ok: false, error: { message: refusal } };
  }
  const offSite = offSiteRefusal(host, method, params, tabId);
  if (offSite) return { ok: false, error: { message: offSite } };
  const sel = typeof params.selector === 'string' ? params.selector : '';
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined;
  switch (method) {
    case 'snapshot':
      return host.snapshot(tabId, {
        ...(params.full === true ? { full: true } : {}),
        ...(params.brief === true ? { brief: true } : {}),
      });
    case 'tree':
      return host.tree(tabId);
    case 'find':
      return host.find(String(params.query ?? ''), tabId);
    case 'act':
      return host.act({
        action: String(params.action ?? ''),
        uid: String(params.uid ?? ''),
        ...(typeof params.text === 'string' ? { text: params.text } : {}),
        ...(params.submit === true ? { submit: true } : {}),
        ...(tabId ? { tab_id: tabId } : {}),
      });
    case 'dialog':
      return host.answerDialog({
        accept: params.accept === true,
        ...(typeof params.text === 'string' ? { text: params.text } : {}),
        ...(tabId ? { tabId } : {}),
      });
    case 'select':
      return host.selectOption({
        uid: String(params.uid ?? ''),
        option: String(params.option ?? ''),
        ...(tabId ? { tabId } : {}),
      });
    case 'scroll':
      return host.scroll({
        direction: params.direction === 'up' ? 'up' : 'down',
        ...(typeof params.screens === 'number' ? { screens: params.screens } : {}),
        ...(typeof params.uid === 'string' && params.uid ? { uid: params.uid } : {}),
        ...(tabId ? { tabId } : {}),
      });
    case 'wait':
      return host.waitFor({
        text: String(params.text ?? ''),
        ...(params.gone === true ? { gone: true } : {}),
        ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
        ...(tabId ? { tabId } : {}),
      });
    case 'point': {
      const action = String(params.action ?? '') as PointAction;
      if (!POINT_ACTIONS.has(action)) return { ok: false, error: { message: `unknown point action: ${action}` } };
      const point: PointParams = {
        action,
        view: String(params.view ?? ''),
        ...(typeof params.x === 'number' ? { x: params.x } : {}),
        ...(typeof params.y === 'number' ? { y: params.y } : {}),
        ...(Array.isArray(params.path) ? { path: params.path.filter(isPair) } : {}),
        ...(typeof params.direction === 'string' && DIRECTIONS.has(params.direction)
          ? { direction: params.direction as NonNullable<PointParams['direction']> }
          : {}),
        ...(typeof params.screens === 'number' ? { screens: params.screens } : {}),
        ...(typeof params.text === 'string' ? { text: params.text } : {}),
        ...(typeof params.key === 'string' ? { key: params.key } : {}),
        ...(tabId ? { tabId } : {}),
      };
      return host.point(point);
    }
    case 'upload':
      return host.upload({
        uid: String(params.uid ?? ''),
        paths: Array.isArray(params.paths) ? params.paths.filter((p): p is string => typeof p === 'string') : [],
        ...(tabId ? { tabId } : {}),
      });
    case 'goto': {
      const url = params.url;
      if (typeof url !== 'string') return { ok: false, error: { message: 'url is required' } };
      return host.goto(url, tabId);
    }
    case 'tabs': {
      const action = String(params.action ?? 'list');
      try {
        if (action === 'new') {
          const url = typeof params.url === 'string' && params.url ? params.url : 'about:blank';
          const newId = await host.newTab(url);
          // A tab the agent asked for is the tab the agent is now working in.
          host.noteAgentTab(newId);
          return { ok: true, result: { tabId: newId, tabs: host.list(), activeTabId: host.activeId } };
        }
        if (action === 'select') {
          if (!named) return { ok: false, error: { message: 'tab_id is required for select' } };
          host.select(named);
        }
        if (action === 'close') {
          if (!named) return { ok: false, error: { message: 'tab_id is required for close' } };
          await (opts.closeTab ?? ((id: string) => host.unregister(id)))(named);
        }
        return { ok: true, result: { tabs: host.list(), activeTabId: host.activeId } };
      } catch (err) {
        return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
      }
    }
    case 'capture':
      return host.capture({
        view: true,
        ...(tabId ? { tabId } : {}),
        ...(params.clip ? { clip: params.clip as { x: number; y: number; width: number; height: number } } : {}),
        ...(params.format === 'jpeg' ? { format: 'jpeg' as const } : {}),
      });
    case 'back':
    case 'forward':
    case 'reload':
      return host.history(method, tabId);
    case 'await_human':
      return host.awaitHuman({
        ...(tabId ? { tabId } : {}),
        reason: String(params.reason ?? 'The page needs you to do something the agent must not do itself.'),
      });
    case 'box':
      return host.boxOf(String(params.uid ?? ''), tabId);

    // Below the accessibility layer: what `browser_session` asks for.
    case 'click':
      return host.clickSelector(sel, { ...(tabId ? { tabId } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
    case 'fill':
      return host.fillSelector(sel, String(params.value ?? ''), {
        ...(tabId ? { tabId } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    case 'key':
      return host.key(String(params.key ?? ''), tabId);
    case 'text':
      return host.textOf(sel || undefined, tabId);
    case 'html':
      return host.htmlOf(tabId);
    case 'eval':
      return host.evaluate(String(params.expression ?? ''), tabId);
    case 'screenshot':
      return host.capture({
        ...(tabId ? { tabId } : {}),
        ...(params.fullPage === true ? { fullPage: true } : {}),
      });
    case 'url': {
      const tabs = host.list();
      const current = tabs.find((t) => (tabId ? t.tabId === tabId : t.active));
      return current ? { ok: true, result: current.url } : { ok: false, error: { message: 'no open tab' } };
    }
    default:
      return { ok: false, error: { message: `unknown method: ${method}` } };
  }
}

/**
 * Why this call would land on a site the conversation has not allowed, or
 * null. A navigation is judged by where it goes; any other action by the page
 * it acts on. Reading, scrolling, pointing and waiting decide nothing and go
 * anywhere. A call that carries no `sites` comes from `browser_session`, which
 * the user approves call by call — that approval is its consent.
 */
function offSiteRefusal(host: BrowserHost, method: string, params: Record<string, unknown>, tabId: string | undefined): string | null {
  if (!Array.isArray(params.sites)) return null;
  const sites = params.sites.filter((site): site is string => typeof site === 'string');
  const destination = (url: unknown): string | null =>
    typeof url === 'string' && url && !siteAllows(sites, url) ? siteRefusal(url) : null;
  const here = (tab: string | undefined): string | null => {
    const page = host.list().find((t) => (tab ? t.tabId === tab : t.active));
    // No such tab: let the action report that in its own words.
    return page && !siteAllows(sites, page.url) ? siteRefusal(page.url) : null;
  };
  switch (method) {
    case 'goto':
      return destination(params.url);
    case 'tabs':
      if (params.action === 'new') return destination(params.url);
      return params.action === 'close' ? here(tabId) : null;
    case 'act':
      return params.action === 'hover' ? null : here(tabId);
    case 'select':
    case 'key':
    case 'point':
    case 'upload':
    case 'back':
    case 'forward':
    case 'reload':
      return here(tabId);
    default:
      return null;
  }
}
