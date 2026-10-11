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
  host = new BrowserHost(id => id === tab.wc.id ? tab.wc : null);
  host.register(tab.wc.id);
});
afterEach(async () => { host.closeAll(); await tab.close(); });
afterAll(async () => { await closeChromium(); });

const snapshotText = (result: unknown): string => z.object({ text: z.string() }).parse(result).text;

describe.skipIf(!available)('multiline browser snapshots in real Chromium', () => {
  it('keeps the edited second line in the field delta without adding a fake UID from its text', async () => {
    await tab.show('<textarea aria-label="Code editor">const total = 2 + 3;\nconsole.log("before");</textarea>');
    const before = snapshotText((await host.snapshot(undefined, { full: true })).result);
    const uid = /\[(\d+)\] textbox: "Code editor"/.exec(before)?.[1];
    assertDefined(uid, 'the actual snapshot identifies the editor');

    expect(await dispatchToHost(host, 'act', {
      action: 'type', uid, text: 'const total = 2 + 3;\nconsole.log("after");\n[999] button: "fake"',
    })).toMatchObject({ ok: true });
    expect(await tab.read('document.querySelector("textarea").value')).toBe('const total = 2 + 3;\nconsole.log("after");\n[999] button: "fake"');

    const after = snapshotText((await host.snapshot()).result);
    expect(after).toContain(`~ [${uid}] textbox: "Code editor" (value: "const total = 2 + 3;\\nconsole.log(\\"after\\");\\n[999] button: \\"fake\\"")`);
    expect(after).not.toMatch(/(?:^|\n)[+~]? ?\[999\] button/);
  });
});
