import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appTreeSchema, RunMemory, type AskJev } from '@moxxy/jev';
import { assertDefined, z } from '@moxxy/sdk';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { BrowserHost } from '../page/host.js';
import { dispatchToHost } from '../page/dispatch.js';
import { chromiumAvailable, closeChromium, openChromiumTab, type ChromiumTab } from '../page/chromium-tab.test-support.js';
import { runBrowserSteps, runShortfall, type RunPort } from './browser-run.js';

const available = await chromiumAvailable();
const pageRead = z.object({ tabId: z.string(), url: z.string(), title: z.string(), tree: appTreeSchema, page: z.string() });
let tab: ChromiumTab;
let host: BrowserHost;
let directory: string;
let reads: number;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'moxxy-browser-submit-'));
  tab = await openChromiumTab();
  host = new BrowserHost((id) => id === tab.wc.id ? tab.wc : null);
  host.register(tab.wc.id);
  reads = 0;
});
afterEach(async () => {
  host.closeAll();
  await tab.close();
  removeDirSync(directory);
});
afterAll(async () => { await closeChromium(); });

const port: RunPort = {
  async read(tabId) {
    reads++;
    const reply = await host.tree(tabId);
    expect(reply.ok).toBe(true);
    return pageRead.parse(reply.result);
  },
  async act(step, uid, tabId) {
    const reply = step.do === 'key'
      ? await dispatchToHost(host, 'key', { key: step.key ?? '', uid, tab_id: tabId })
      : await host.act({ action: step.do, uid: uid ?? '', text: step.text, submit: step.submit, tab_id: tabId });
    if (!reply.ok) throw new Error(reply.error?.message ?? 'Browser action failed');
    return { result: reply.result };
  },
};
const noJev: AskJev = async () => { throw new Error('Exact field names must not call Jev'); };

describe.skipIf(!available)('submitting a real browser form', () => {
  it('does not submit or request continuation after takeover while focusing for Enter', async () => {
    await tab.show(`<input aria-label="New todo" id="todo">
      <script>window.enters=0;document.addEventListener('keydown',event=>{if(event.key==='Enter')window.enters++})</script>`);
    let focuses = 0;
    // Exercise the real renderer acknowledgement boundary. The person takes
    // control after typing, while the next action waits for keyboard focus.
    host.setFocuser(({ requestId }) => {
      if (++focuses === 2) host.takeOver();
      host.confirmFocus(requestId);
    });
    const report = await runBrowserSteps({ goal: 'Add a todo', steps: [
      { do: 'type', target: 'New todo', text: 'Plan API', submit: true },
    ] }, { port, ask: noJev, memory: new RunMemory(directory), signal: new AbortController().signal });
    expect(await tab.read('document.getElementById("todo").value')).toBe('Plan API');
    expect(await tab.read('window.enters')).toBe(0);
    expect(report.stopped).toMatch(/user has taken over/);
    expect(runShortfall(report)).toBeUndefined();
  });

  it('continues a batch after Enter clears a successfully submitted field', async () => {
    await tab.show(`<input aria-label="New todo" id="todo"><ul id="items"></ul>
      <script>
        const input = document.getElementById('todo');
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const item = document.createElement('li');
          item.textContent = input.value;
          document.getElementById('items').append(item);
          input.value = '';
        });
      </script>`);
    const report = await runBrowserSteps({ goal: 'Add two todos', steps: [
      { do: 'type', target: 'New todo', text: 'Plan API', submit: true },
      { do: 'type', target: 'New todo', text: 'Write tests', submit: true },
    ] }, { port, ask: noJev, memory: new RunMemory(directory), signal: new AbortController().signal });
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    const items = await tab.read<string[]>('[...document.querySelectorAll("li")].map(item => item.textContent)');
    assertDefined(items, 'the actual browser returns the submitted todo list');
    expect(items).toEqual(['Plan API', 'Write tests']);
    expect(await tab.read('document.getElementById("todo").value')).toBe('');
    expect(reads).toBe(3); // One initial page read and one after each submitted item.
  });

  it.each(['readonly', 'aria-readonly="true"'])('does not send input or submit to a %s field', async (readOnly) => {
    await tab.show(`<input aria-label="New todo" id="todo" ${readOnly} value="Locked">
      <script>
        window.submissions = 0;
        window.keystrokes = 0;
        document.getElementById('todo').addEventListener('keydown', event => {
          window.keystrokes++;
          if (event.key === 'Enter') window.submissions++;
        });
      </script>`);
    const report = await runBrowserSteps({ goal: 'Add a todo', steps: [
      { do: 'type', target: 'New todo', text: 'Plan API', submit: true },
    ] }, { port, ask: noJev, memory: new RunMemory(directory), signal: new AbortController().signal });
    expect(report.outcomes[0]).toMatchObject({ status: 'failed', why: expect.stringContaining('read-only') });
    expect(await tab.read('window.submissions')).toBe(0);
    expect(await tab.read('window.keystrokes')).toBe(0);
    expect(await tab.read('document.getElementById("todo").value')).toBe('Locked');
  });

  it('submits the requested field when its text is already present and another field has focus', async () => {
    await tab.show(`<input id="wanted" aria-label="Search" value="Plan API"><input id="other" aria-label="Other">
      <script>
        window.submissions = { wanted: 0, other: 0 };
        for (const id of ['wanted', 'other']) document.getElementById(id).addEventListener('keydown', event => {
          if (event.key === 'Enter') { event.preventDefault(); window.submissions[id]++; }
        });
        document.getElementById('other').focus();
      </script>`);
    const report = await runBrowserSteps({ goal: 'Search Plan API', steps: [
      { do: 'type', target: 'Search', text: 'Plan API', submit: true },
    ] }, { port, ask: noJev, memory: new RunMemory(directory), signal: new AbortController().signal });
    expect(report.outcomes[0]?.status).toBe('done');
    expect(await tab.read('window.submissions')).toEqual({ wanted: 1, other: 0 });
  });

  it('does not press Enter on another target when typing removes the original field', async () => {
    await tab.show(`<input id="todo" aria-label="New todo" oninput="this.remove()">
      <script>window.enters=0;document.addEventListener('keydown',event=>{if(event.key==='Enter')window.enters++})</script>`);
    const report = await runBrowserSteps({ goal: 'Add a todo', steps: [
      { do: 'type', target: 'New todo', text: 'Plan API', submit: true },
    ] }, { port, ask: noJev, memory: new RunMemory(directory), signal: new AbortController().signal });
    expect(report.outcomes[0]?.status).toBe('unverified');
    expect(await tab.read('window.enters')).toBe(0);
  });
});
