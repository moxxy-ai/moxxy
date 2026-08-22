import { formatSnapshot, type TabInfo } from '../ax/snapshot.js';
import { detectWall, type WallKind } from '../ax/wall.js';
import { diffRendering, renderingFromText } from '../ax/diff.js';
import { formatAxTree } from '../ax/format.js';
import { redactSecretValues } from '../ax/snapshot.js';
import { newUidMemory } from '../ax/tree.js';
import type { AxNode } from '../ax/tree.js';
import { captureAx, pointForBackendNode } from './perceive.js';
import type { SidecarState } from './state.js';
import { badParams, errMsg, SidecarError, type CdpSession, type PageHandle, type PlaywrightHandle, type Reply, type Req } from './types.js';

/**
 * The operations the model calls: read the page, act on what it read, manage
 * tabs.
 *
 * One rule shapes all of it. A uid is only meaningful against the snapshot it
 * came from, so acting on a uid re-checks that the page is still the page that
 * produced it. When it isn't, the call fails and says so. That is deliberately
 * stricter than "try anyway": a click that lands on whatever now occupies the
 * old position is invisible to every layer above, and the model will happily
 * build its next three steps on top of it.
 */


/** Open (and remember) the CDP channel for a tab. */
async function cdpFor(state: SidecarState, handle: PlaywrightHandle, tabId: string, page: PageHandle): Promise<CdpSession> {
  state.cdp ??= new Map();
  const existing = state.cdp.get(tabId);
  if (existing) return existing;
  const open = handle.context.newCDPSession;
  if (!open) {
    throw new SidecarError(
      'this browser does not expose CDP (accessibility perception needs chromium)',
      'runtime',
    );
  }
  const session = await open.call(handle.context, page);
  state.cdp.set(tabId, session);
  return session;
}

/** Best-effort page title; a failure here must not fail the snapshot. */
async function titleOf(page: PageHandle): Promise<string> {
  try {
    const value = await page.evaluate('document.title');
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

async function tabInfos(state: SidecarState): Promise<TabInfo[]> {
  const registry = state.tabs;
  if (!registry) return [];
  const active = registry.activeId;
  return Promise.all(
    registry.list().map(async ({ id, page }) => ({
      tabId: id,
      url: page.url(),
      title: await titleOf(page),
      active: id === active,
    })),
  );
}

/** Resolve the tab a request targets: explicit `tab_id`, else the active one. */
function targetTab(state: SidecarState, params: Record<string, unknown>): { id: string; page: PageHandle } {
  const registry = state.tabs;
  if (!registry) throw new SidecarError('no open tab', 'runtime');
  const raw = params.tab_id;
  if (raw !== undefined && typeof raw !== 'string') throw badParams('tab_id must be a string');
  return registry.get(raw as string | undefined);
}

/**
 * Whether this page is really waiting on a person.
 *
 * The detector reads the accessibility tree, which is enough to spot a consent
 * button or a password field and not enough to know either is on screen. A
 * control can sit in the tree undrawn, and a wall reported from one of those
 * traps the agent in a hand-off nobody can answer: the person is told to press
 * something they cannot see. `pointForBackendNode` already answers "is there a
 * box to aim at", which is the same question.
 */
async function confirmWall(
  cdp: CdpSession,
  // AxTree is the root node with an index hung off it, so one value is both.
  tree: AxNode & { index: ReadonlyMap<string, AxNode> },
): Promise<WallKind | null> {
  const found = detectWall(tree);
  if (!found) return null;
  const node = tree.index.get(found.uid);
  if (node?.backendNodeId === undefined) return null;
  return (await pointForBackendNode(cdp, node.backendNodeId)) ? found.kind : null;
}

/**
 * Read a tab: accessibility tree, address, title, and the full tab list.
 *
 * The tab list rides along on purpose. The model never has to spend a call
 * asking where it is, because every perception answer already says so.
 */
export async function opSnapshot(state: SidecarState, handle: PlaywrightHandle, req: Req): Promise<Reply> {
  try {
    const params = req.params ?? {};
    const { id, page } = targetTab(state, params);
    const cdp = await cdpFor(state, handle, id, page);

    // One memory per document, so a uid means the same element read after read
    // — the thing a difference is described against.
    state.uids ??= new Map();
    state.renderings ??= new Map();
    const previousUrl = state.snapshots?.get(id)?.url;
    if (previousUrl !== undefined && previousUrl !== page.url()) {
      state.uids.delete(id);
      state.renderings.delete(id);
    }
    let memory = state.uids.get(id);
    if (!memory) {
      memory = newUidMemory();
      state.uids.set(id, memory);
    }

    const tree = await captureAx(cdp, memory);
    const url = page.url();

    state.snapshots ??= new Map();
    if (tree) state.snapshots.set(id, { index: tree.index, url });
    else state.snapshots.delete(id);

    const wall = tree ? await confirmWall(cdp, tree) : null;
    const full = tree ? formatAxTree(redactSecretValues(tree)) : null;
    const rendering = full !== null ? renderingFromText(full) : new Map<string, string>();
    const previous = state.renderings.get(id);
    const wantsFull = (req.params ?? {}).full === true;
    const changes = !wantsFull && previous !== undefined && tree !== null ? diffRendering(previous, rendering) : null;
    if (tree) state.renderings.set(id, rendering);
    else state.renderings.delete(id);

    const body = changes
      ? [
          'Changes since your last read of this tab. Everything else is as you last saw it;',
          'ask for the whole tree with full: true if you have lost your bearings.',
          '',
          ...changes,
        ].join('\n')
      : full ?? undefined;

    const text = formatSnapshot({
      tree,
      url,
      title: await titleOf(page),
      tabs: await tabInfos(state),
      wall,
      ...(body !== undefined ? { body } : {}),
    });
    return { id: req.id, ok: true, result: { text, tabId: id, url, nodes: tree ? tree.index.size : 0 } };
  } catch (err) {
    return { id: req.id, ok: false, error: { message: errMsg(err), kind: err instanceof SidecarError ? err.kind : 'runtime' } };
  }
}

/**
 * Act on a node the last snapshot named.
 *
 * Refuses on three separate grounds, each of which would otherwise produce a
 * click on the wrong thing: no snapshot yet, a uid that was never in one, and
 * a page that has navigated since. The third is the one that bites in
 * practice, because it looks like success right up until it doesn't.
 */
export async function opAct(state: SidecarState, handle: PlaywrightHandle, req: Req): Promise<Reply> {
  try {
    const params = req.params ?? {};
    const action = params.action;
    const uid = params.uid;
    if (typeof action !== 'string') throw badParams('action is required');
    if (typeof uid !== 'string') throw badParams('uid is required');

    const { id, page } = targetTab(state, params);
    const snapshot = state.snapshots?.get(id);
    if (!snapshot) {
      throw new SidecarError(`no snapshot for tab ${id} — call snapshot first`, 'runtime');
    }
    if (snapshot.url !== page.url()) {
      throw new SidecarError(
        `tab ${id} navigated since the last snapshot (was ${snapshot.url}, now ${page.url()}) — ` +
          `uids are stale, take a fresh snapshot`,
        'runtime',
      );
    }

    const node = snapshot.index.get(uid);
    if (!node) throw new SidecarError(`uid ${uid} is not in the last snapshot of tab ${id}`, 'runtime');
    if (node.backendNodeId === undefined) {
      throw new SidecarError(`uid ${uid} (${node.role}) has no DOM node to act on`, 'runtime');
    }

    const cdp = await cdpFor(state, handle, id, page);
    const point = await pointForBackendNode(cdp, node.backendNodeId);
    if (!point) {
      throw new SidecarError(`uid ${uid} (${node.role}) is not visible on screen`, 'runtime');
    }

    switch (action) {
      case 'click':
        await page.mouse.click(point.x, point.y);
        break;
      case 'hover':
        await page.mouse.move(point.x, point.y);
        break;
      case 'type': {
        const text = params.text;
        if (typeof text !== 'string') throw badParams('text is required for type');
        await page.mouse.click(point.x, point.y);
        await page.keyboard.type(text);
        break;
      }
      default:
        throw badParams(`unknown action ${action}`);
    }

    return { id: req.id, ok: true, result: { tabId: id, url: page.url() } };
  } catch (err) {
    return { id: req.id, ok: false, error: { message: errMsg(err), kind: err instanceof SidecarError ? err.kind : 'runtime' } };
  }
}

/** list / new / select / close, over the named-tab registry. */
export async function opTabs(state: SidecarState, handle: PlaywrightHandle, req: Req): Promise<Reply> {
  try {
    const params = req.params ?? {};
    const action = params.action ?? 'list';
    const registry = state.tabs;
    if (!registry) throw new SidecarError('browser not started', 'runtime');

    switch (action) {
      case 'list':
        break;
      case 'new': {
        const page = (await handle.context.newPage()) as PageHandle;
        const tabId = registry.add(page);
        const url = params.url;
        if (typeof url === 'string' && url.length > 0) await page.goto(url);
        return { id: req.id, ok: true, result: { tabId, tabs: await tabInfos(state), activeTabId: registry.activeId } };
      }
      case 'select': {
        const tabId = params.tab_id;
        if (typeof tabId !== 'string') throw badParams('tab_id is required for select');
        registry.select(tabId);
        break;
      }
      case 'close': {
        const tabId = params.tab_id;
        if (typeof tabId !== 'string') throw badParams('tab_id is required for close');
        registry.get(tabId); // throws with the open-tab list when unknown
        await registry.close(tabId);
        state.cdp?.delete(tabId);
        state.snapshots?.delete(tabId);
        break;
      }
      default:
        throw badParams(`unknown tabs action ${String(action)}`);
    }

    return { id: req.id, ok: true, result: { tabs: await tabInfos(state), activeTabId: registry.activeId } };
  } catch (err) {
    return { id: req.id, ok: false, error: { message: errMsg(err), kind: err instanceof SidecarError ? err.kind : 'runtime' } };
  }
}
