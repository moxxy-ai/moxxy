import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined, z } from '@moxxy/sdk';
import { BrowserHost } from './host.js';
import { dispatchToHost } from './dispatch.js';
import { chromiumAvailable, closeChromium, openChromiumTab, type ChromiumTab } from './chromium-tab.test-support.js';

const available = await chromiumAvailable();
let tab: ChromiumTab;
let host: BrowserHost;

beforeEach(async () => {
  tab = await openChromiumTab();
  host = new BrowserHost((id) => id === tab.wc.id ? tab.wc : null);
  host.register(tab.wc.id);
});
afterEach(async () => { host.closeAll(); await tab.close(); });
afterAll(async () => { await closeChromium(); });

async function labelUid(): Promise<string> {
  const snapshot = await host.snapshot(undefined, { full: true });
  expect(snapshot.ok).toBe(true);
  const { text } = z.object({ text: z.string() }).parse(snapshot.result);
  const uid = /\[([^\]]+)\] LabelText/.exec(text)?.[1];
  assertDefined(uid, 'the snapshot identifies the visible todo label');
  return uid;
}

describe.skipIf(!available)('double clicking a browser uid', () => {
  it('identifies the owner of a newly visible delete button in a delta snapshot', async () => {
    await tab.show(`<style>li button{display:none}li:hover button{display:inline-block}</style><ul>
      <li id="plan"><label>Plan API</label><button aria-label="Delete todo" onclick="this.closest('li').remove()">×</button></li>
      <li id="tests"><label>Write tests</label><button aria-label="Delete todo" onclick="this.closest('li').remove()">×</button></li>
    </ul>`);
    const label = await labelUid();
    expect(await host.act({ action: 'hover', uid: label })).toMatchObject({ ok: true });
    const delta = await host.snapshot();
    const { text } = z.object({ text: z.string() }).parse(delta.result);
    expect(text).toContain('row "Plan API"');
    const remove = /\[([^\]]+)\] button: "Delete todo"[^\n]*row "Plan API"/.exec(text)?.[1];
    assertDefined(remove, 'the delta identifies both the actionable UID and its actual row');
    expect(await host.act({ action: 'click', uid: remove })).toMatchObject({ ok: true });
    expect(await tab.read('document.getElementById("plan")')).toBeNull();
    expect(await tab.read('Boolean(document.getElementById("tests"))')).toBe(true);
  });

  it('delivers two real clicks and opens editing through the label dblclick handler', async () => {
    await tab.show(`<label id="task" onclick="window.clicks++" ondblclick="document.getElementById('edit').hidden=false">Implement fix</label>
      <input id="edit" aria-label="Edit todo" hidden><script>window.clicks=0</script>`);
    const uid = await labelUid();
    expect(await dispatchToHost(host, 'act', { action: 'click', uid, click_count: 2 })).toMatchObject({ ok: true });
    expect(await tab.read('window.clicks')).toBe(2);
    expect(await tab.read('document.getElementById("edit").hidden')).toBe(false);
  });

  it.each([0, 3, 1.5])('refuses unsupported click count %s before clicking', async (click_count) => {
    await tab.show('<label onclick="window.clicks++">Implement fix</label><script>window.clicks=0</script>');
    const uid = await labelUid();
    expect(await dispatchToHost(host, 'act', { action: 'click', uid, click_count })).toMatchObject({ ok: false });
    expect(await tab.read('window.clicks')).toBe(0);
  });
});
