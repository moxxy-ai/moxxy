import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { armPressCheck, pressAt, type Cdp } from './input.js';
import { chromiumAvailable, closeChromium, openChromiumTab, type ChromiumTab } from './chromium-tab.test-support.js';

/**
 * Whether a press reached the page, against a real Chromium.
 *
 * In the desktop a press is slow to land when the window is behind another
 * one: Chromium holds input for the next frame, and a window nobody sees draws
 * few. The check gave up two seconds after it was armed — while the press was
 * still on its way — and reported a click that opened Coolify's form as "the
 * tab is not on screen". It waits from the press, not from the arming.
 */
const available = await chromiumAvailable();

afterAll(async () => {
  await closeChromium();
}, 30_000);

let tab: ChromiumTab | null = null;
afterEach(async () => {
  await tab?.close();
  tab = null;
});

async function buttonOnPage(): Promise<{ cdp: Cdp; backendNodeId: number; centre: { x: number; y: number } }> {
  tab = await openChromiumTab();
  await tab.show('<button id="go" style="position:absolute;left:40px;top:40px;width:80px;height:30px">Go</button>');
  const wc = tab.wc;
  const cdp: Cdp = { send: (method, params) => wc.debugger.sendCommand(method, params) };
  const { root } = (await cdp.send('DOM.getDocument')) as { root: { nodeId: number } };
  const { nodeId } = (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#go' })) as { nodeId: number };
  const { node } = (await cdp.send('DOM.describeNode', { nodeId })) as { node: { backendNodeId: number } };
  return { cdp, backendNodeId: node.backendNodeId, centre: { x: 80, y: 55 } };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!available)('armPressCheck in a real Chromium page', () => {
  it('counts a press that lands later than the wait, measured from the arming', async () => {
    const { cdp, backendNodeId, centre } = await buttonOnPage();

    const felt = await armPressCheck(cdp, backendNodeId, 200);
    await pause(400);
    await pressAt(cdp, centre);

    expect(await felt()).toBe(true);
  });

  it('still says so when no press came at all', async () => {
    const { cdp, backendNodeId } = await buttonOnPage();

    const felt = await armPressCheck(cdp, backendNodeId, 200);

    expect(await felt()).toBe(false);
  });
});
