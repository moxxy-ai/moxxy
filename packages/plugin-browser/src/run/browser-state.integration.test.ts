import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { appTreeSchema, RunMemory, type AskJev } from '@moxxy/jev';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { appTreeOf } from '../ax/app-tree.js';
import { buildAxTree, newUidMemory, type AxNodeRaw, type AxTree } from '../ax/tree.js';
import { declineNote, detectWall } from '../ax/wall.js';
import { formatSnapshot } from '../ax/snapshot.js';
import { runBrowserSteps, type RunPort, type RunStep } from './browser-run.js';

let browser: Browser;
let page: Page;
let cdp: CDPSession;
let directory: string;
let tree: AxTree;
let memory: ReturnType<typeof newUidMemory>;
let clicks: number;

beforeAll(async () => { browser = await chromium.launch(); }, 30_000);
afterAll(async () => { await browser?.close(); }, 30_000);
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'moxxy-browser-state-'));
  page = await browser.newPage();
  cdp = await page.context().newCDPSession(page);
  memory = newUidMemory();
  clicks = 0;
});
afterEach(async () => {
  await page.close();
  removeDirSync(directory);
});

async function readTree(): Promise<AxTree> {
  const raw = await cdp.send('Accessibility.getFullAXTree') as { nodes: AxNodeRaw[] };
  const found = buildAxTree(raw.nodes, memory);
  assertDefined(found, 'Chromium returned the page accessibility tree');
  tree = found;
  return found;
}

async function click(uid: string): Promise<void> {
  const backendNodeId = tree.index.get(uid)?.backendNodeId;
  assertDefined(backendNodeId, 'the click targets an element in the current tree');
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId }) as { model: { content: number[] } };
  const xs = model.content.filter((_, i) => i % 2 === 0);
  const ys = model.content.filter((_, i) => i % 2 === 1);
  const point = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  clicks++;
}

const port: RunPort = {
  async read() {
    const found = await readTree();
    const result = appTreeSchema.parse(appTreeOf(found, { app: 'fixture.test', window: 'Settings' }));
    return { tabId: 'test', url: 'https://fixture.test', title: 'Settings', tree: result, page: await page.locator('body').innerText() };
  },
  async act(step, uid) {
    expect(step.do).toBe('click');
    assertDefined(uid, 'a state-setting step targets a checkbox');
    await click(uid);
    return {};
  },
};

// Exact names resolve locally. The external Jev boundary must never be called
// in these deterministic browser tests; it needs a network service and a key.
const noJev: AskJev = async () => { throw new Error('An exact label must not need the Jev service'); };
const run = (step: RunStep) => runBrowserSteps({ goal: 'Set the requested checkbox state', steps: [step] }, {
  port, ask: noJev, signal: new AbortController().signal, memory: new RunMemory(directory),
});

describe('terms agreement on the real page', () => {
  it.each(['I agree to the terms', 'Zgadzam się na regulamin'])('asks the user for "%s" without offering cookie rejection', async (label) => {
    await page.setContent(`<label><input id="terms" type="checkbox">${label}</label>`);
    const found = await readTree();
    const agreement = [...found.index.values()].find((element) => element.role === 'checkbox');
    assertDefined(agreement, 'Chromium exposes the terms checkbox');
    expect(agreement.name).toBe(label);
    const wall = detectWall(found);
    expect(wall).toEqual({ kind: 'consent', uid: agreement.uid });
    assertDefined(wall, 'the terms agreement needs the user');
    const snapshot = formatSnapshot({ tree: found, url: 'https://fixture.test', title: 'Terms', tabs: [], wall: wall.kind });
    expect(snapshot).toContain('### Needs you');
    expect(snapshot).toContain('browser_await_human');
    expect(snapshot).not.toContain('### Cookie banner');
    expect(await page.locator('#terms').isChecked()).toBe(false);
    expect(clicks).toBe(0);
  });
});

describe('cookie rejection on the real page', () => {
  it.each(['Akceptuj tylko niezbędne', 'Accept only necessary cookies'])('declines through "%s" and carries on when only the footer opener remains', async (label) => {
    await page.setContent(`<main><button id="task" onclick="this.dataset.clicked='yes'">Continue task</button></main>
      <button id="invitations" onclick="this.dataset.clicked='yes'">Reject all invitations</button>
      <div role="dialog" aria-label="Privacy"><p>We use cookies for statistics.</p>
        <button id="accept" onclick="this.dataset.clicked='yes'">Accept all cookies</button>
        <button id="necessary" onclick="document.body.dataset.consent='necessary';this.closest('[role=dialog]').remove()">${label}</button>
      </div>
      <footer><button>Ustawienia plików cookie</button></footer>`);
    const wall = detectWall(await readTree());
    assertDefined(wall?.decline, 'the banner offers the necessary-only choice');
    await click(wall.decline.uid);
    expect(await page.locator('body').getAttribute('data-consent')).toBe('necessary');
    expect(await page.locator('#invitations').getAttribute('data-clicked')).toBeNull();
    const found = await readTree();
    expect(detectWall(found)).toBeNull();
    expect(formatSnapshot({ tree: found, url: 'https://fixture.test', title: 'Task', tabs: [], wall: null })).not.toContain('### Needs you');
    const task = [...found.index.values()].find((element) => element.name === 'Continue task' && element.role === 'button');
    assertDefined(task, 'the task button remains available after declining cookies');
    await click(task.uid);
    expect(await page.locator('#task').getAttribute('data-clicked')).toBe('yes');
    expect(clicks).toBe(2);
  });

  it('presses an explicit cookie decline when the AX tree has no banner container', async () => {
    await page.setContent(`<button id="accept" onclick="this.dataset.clicked='yes'">Accept all cookies</button>
      <button id="decline" onclick="this.dataset.clicked='yes'">Reject all cookies</button>`);
    const wall = detectWall(await readTree());
    assertDefined(wall?.decline, 'the explicitly named declining control is available');
    await click(wall.decline.uid);
    expect(await page.locator('#accept').getAttribute('data-clicked')).toBeNull();
    expect(await page.locator('#decline').getAttribute('data-clicked')).toBe('yes');
  });

  it.each(['en', 'pl'])('presses only the cookie button beside invitations (%s)', async (language) => {
    const label = language === 'pl' ? 'Odrzuć wszystkie' : 'Reject all';
    await page.setContent(`<button id="invitations" onclick="this.dataset.clicked='yes'">${label}</button>
      <div role="dialog" aria-label="Privacy"><p>We use cookies for statistics.</p>
      <button id="cookies" onclick="this.dataset.clicked='yes'">${label}</button></div>`);
    const wall = detectWall(await readTree());
    assertDefined(wall?.decline, 'the cookie banner has a declining control');
    expect(declineNote(wall.decline.name, wall.decline.uid)).toContain(`uid="${wall.decline.uid}"`);
    await click(wall.decline.uid);
    expect(await page.locator('#cookies').getAttribute('data-clicked')).toBe('yes');
    expect(await page.locator('#invitations').getAttribute('data-clicked')).toBeNull();
    expect(clicks).toBe(1);
  });
});

describe('checkbox state on the real page', () => {
  it.each([
    { checked: true, do: 'uncheck', after: false, clicks: 1 },
    { checked: false, do: 'check', after: true, clicks: 1 },
    { checked: true, do: 'check', after: true, clicks: 0 },
    { checked: false, do: 'uncheck', after: false, clicks: 0 },
  ] as const)('keeps ordinary checkboxes idempotent: $checked / $do', async (expected) => {
    await page.setContent(`<label><input id="box" type="checkbox" ${expected.checked ? 'checked' : ''}>Notifications</label>`);
    expect((await run({ do: expected.do, target: 'Notifications' })).outcomes[0]?.status).toBe('done');
    expect(await page.locator('#box').isChecked()).toBe(expected.after);
    expect(clicks).toBe(expected.clicks);
  });

  it('reads the changed state of an ARIA switch', async () => {
    await page.setContent(`<button id="switch" role="switch" aria-checked="false" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')">Notifications</button>`);
    expect((await run({ do: 'check', target: 'Notifications' })).outcomes[0]?.status).toBe('done');
    expect((await run({ do: 'check', target: 'Notifications' })).outcomes[0]?.state).toBe('already on');
    expect(await page.locator('#switch').getAttribute('aria-checked')).toBe('true');
    expect(clicks).toBe(1);
  });

  it('does not report a disabled checkbox as changed', async () => {
    await page.setContent('<label><input id="box" type="checkbox" checked disabled>Notifications</label>');
    expect((await run({ do: 'uncheck', target: 'Notifications' })).outcomes[0]?.status).toBe('failed');
    expect(await page.locator('#box').isChecked()).toBe(true);
    expect(clicks).toBe(1);
  });

  it('does not confirm a box that disappears after the click', async () => {
    await page.setContent('<label><input id="box" type="checkbox" onclick="this.remove()">Notifications</label>');
    expect((await run({ do: 'check', target: 'Notifications' })).outcomes[0]?.status).toBe('unverified');
    expect(await page.locator('#box').count()).toBe(0);
    expect(clicks).toBe(1);
  });

  it('does not confirm a box that remains partly checked after the click', async () => {
    await page.setContent('<label><input id="box" type="checkbox" onclick="this.indeterminate=true">Notifications</label>');
    await page.locator('#box').evaluate((node) => { (node as HTMLInputElement).indeterminate = true; });
    const report = await run({ do: 'check', target: 'Notifications' });
    expect(report.outcomes[0]).toMatchObject({ status: 'failed', why: expect.stringContaining('partly checked') });
    expect(await page.locator('#box').evaluate((node) => (node as HTMLInputElement).indeterminate)).toBe(true);
    expect(clicks).toBe(1);
  });

  it.each([
    { checked: true, do: 'uncheck', status: 'done', after: false },
    { checked: false, do: 'check', status: 'done', after: true },
    { checked: true, do: 'check', status: 'failed', after: false },
    { checked: false, do: 'uncheck', status: 'failed', after: true },
  ] as const)('reads mixed instead of off: $checked / $do', async ({ checked, do: action, status, after }) => {
    await page.setContent('<label><input type="checkbox" id="box">Notifications</label>');
    await page.locator('#box').evaluate((node, checked) => {
      const box = node as HTMLInputElement;
      box.checked = checked;
      box.indeterminate = true;
    }, checked);
    const report = await run({ do: action, target: 'Notifications' });
    expect(report.outcomes[0]?.status).toBe(status);
    expect(clicks).toBe(1);
    expect(await page.locator('#box').evaluate((node) => ({ checked: (node as HTMLInputElement).checked, mixed: (node as HTMLInputElement).indeterminate })))
      .toEqual({ checked: after, mixed: false });
    expect(report.outcomes[0]?.state ?? '').not.toMatch(/already/);
  });
});
