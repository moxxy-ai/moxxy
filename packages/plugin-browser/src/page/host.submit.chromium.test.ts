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

async function wantedUid(name = 'Wanted'): Promise<string> {
  const reply = await host.snapshot(undefined, { full: true });
  expect(reply.ok).toBe(true);
  const { text } = z.object({ text: z.string() }).parse(reply.result);
  const uid = [...text.matchAll(/\[([^\]]+)\] (?:textbox|spinbutton|checkbox|button): "([^"]+)"/g)]
    .find(match => match[2] === name)?.[1];
  assertDefined(uid, 'the actual snapshot identifies the requested field');
  return uid;
}

async function keyboardField(): Promise<string> {
  await tab.show(`<input id="wanted" aria-label="Wanted"><script>
    window.characterKeys=[];window.characterReleases=[];window.keyBased=false;
    const field=document.getElementById('wanted');
    field.addEventListener('keydown',e=>{if(e.key.length===1){window.keyBased=true;window.characterKeys.push(e.key);console.log('character')}});
    field.addEventListener('keyup',e=>{if(e.key.length===1)window.characterReleases.push(e.key)});
    field.addEventListener('beforeinput',e=>{if(e.inputType==='insertText'&&!window.keyBased)e.preventDefault()});
    field.addEventListener('input',()=>{window.keyBased=false});
  </script>`);
  return wantedUid();
}

describe.skipIf(!available)('submitting through the single browser type action', () => {
  it('stops the current command after abort without blocking a later command', async () => {
    const uid = await keyboardField();
    const abort = new AbortController();
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, event) => {
      if (event === 'Runtime.consoleAPICalled') abort.abort();
    });
    const options = { signal: abort.signal, closeTab: () => undefined };
    const reply = await dispatchToHost(host, 'act', { action: 'type', uid, text: 'probe' }, options);
    expect(await tab.read('window.characterKeys')).toEqual(['p']);
    expect(await tab.read('window.characterReleases')).toEqual(['p']);
    expect(await tab.read('document.getElementById("wanted").value')).toBe('p');
    expect(reply).toMatchObject({ ok: false });
    expect(await dispatchToHost(host, 'act', { action: 'type', uid, text: 'next' })).toMatchObject({ ok: true });
    expect(await tab.read('document.getElementById("wanted").value')).toBe('next');
  });

  it.each(['act', 'point'])('does not send a second click after takeover through %s', async (method) => {
    await tab.show('<button aria-label="Wanted" onmousedown="console.log(\'pressed\')" onclick="window.activations++">Wanted</button><script>window.activations=0</script>');
    const uid = await wantedUid();
    const picture = z.object({ view: z.string(), width: z.number(), height: z.number() }).parse((await host.capture({ view: true })).result);
    const position = await tab.read<{ x: number; y: number }>('(() => { const b=document.querySelector("button").getBoundingClientRect(); return {x:(b.x+b.width/2)/innerWidth,y:(b.y+b.height/2)/innerHeight}; })()');
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, event) => {
      if (event === 'Runtime.consoleAPICalled') host.takeOver();
    });
    const reply = await dispatchToHost(host, method, method === 'act'
      ? { action: 'click', uid, click_count: 2 }
      : { action: 'double_click', view: picture.view, x: position.x * picture.width, y: position.y * picture.height });
    expect(await tab.read('window.activations')).toBe(1);
    expect(reply).toMatchObject({ ok: false });
  });

  it('does not bulk-insert text after takeover triggered while the field gains focus', async () => {
    await tab.show('<input id="wanted" aria-label="Wanted" onfocus="console.log(\'focused\')">');
    const uid = await wantedUid();
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, method) => {
      if (method === 'Runtime.consoleAPICalled') host.takeOver();
    });
    const reply = await dispatchToHost(host, 'act', { action: 'type', uid, text: 'probe' });
    expect(await tab.read('document.getElementById("wanted").value')).toBe('');
    expect(reply).toMatchObject({ ok: false });
  });

  it('still fills a keyboard-driven field that rejects bulk insertion', async () => {
    expect(await dispatchToHost(host, 'act', { action: 'type', uid: await keyboardField(), text: 'probe' })).toMatchObject({ ok: true });
    expect(await tab.read('document.getElementById("wanted").value')).toBe('probe');
    expect(await tab.read('window.characterKeys')).toEqual(['p', 'r', 'o', 'b', 'e']);
    expect(await tab.read('window.characterReleases')).toEqual(['p', 'r', 'o', 'b', 'e']);
  });

  it('stops the character fallback after takeover while releasing the current key', async () => {
    const uid = await keyboardField();
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, method) => {
      if (method === 'Runtime.consoleAPICalled') host.takeOver();
    });
    const reply = await dispatchToHost(host, 'act', { action: 'type', uid, text: 'probe' });
    expect(await tab.read('window.characterKeys')).toEqual(['p']);
    expect(await tab.read('window.characterReleases')).toEqual(['p']);
    expect(await tab.read('document.getElementById("wanted").value')).toBe('p');
    expect(reply).toMatchObject({ ok: false });
  });

  it('also stops typing from a picture after takeover without leaving the current key pressed', async () => {
    await keyboardField();
    await tab.read('document.getElementById("wanted").focus()');
    const { view } = z.object({ view: z.string() }).parse((await host.capture({ view: true })).result);
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, method) => {
      if (method === 'Runtime.consoleAPICalled') host.takeOver();
    });
    const reply = await dispatchToHost(host, 'point', { action: 'type', view, text: 'probe' });
    expect(await tab.read('window.characterKeys')).toEqual(['p']);
    expect(await tab.read('window.characterReleases')).toEqual(['p']);
    expect(await tab.read('document.getElementById("wanted").value')).toBe('p');
    expect(reply).toMatchObject({ ok: false });
  });

  it('stops selector-based filling when the user takes over while focusing', async () => {
    await tab.show('<input id="wanted" aria-label="Wanted" onfocus="console.log(\'focused\')">');
    await wantedUid();
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, method) => {
      if (method === 'Runtime.consoleAPICalled') host.takeOver();
    });
    expect(await dispatchToHost(host, 'fill', { selector: '#wanted', value: 'probe' })).toMatchObject({ ok: false });
    expect(await tab.read('document.getElementById("wanted").value')).toBe('');
  });

  it.each([
    ['password', 'Wanted'],
    ['text', 'Access token'],
  ])('does not expose a changed stored credential from a %s field', async (type, name) => {
    const secret = 'SYNTHETIC_CREDENTIAL_NOT_FOR_TOOL_OUTPUT';
    await tab.show(`<input id="wanted" type="${type}" aria-label="${name}" oninput="this.value='${secret}'">`);
    const reply = await dispatchToHost(host, 'act', { action: 'type', uid: await wantedUid(name), text: 'probe' });
    expect(JSON.stringify(reply)).not.toContain(secret);
    expect(await tab.read('document.getElementById("wanted").value')).toBe(secret);
  });

  it.each([
    '<button id="wanted" aria-label="Wanted" onclick="window.activations++">Save</button>',
    '<input id="wanted" type="checkbox" aria-label="Wanted" onclick="window.activations++">',
  ])('does not activate a non-text control while asked to type', async (html) => {
    await tab.show(html+'<script>window.activations=0</script>');
    expect(await dispatchToHost(host, 'act', { action: 'type', uid: await wantedUid(), text: 'probe' })).toMatchObject({ ok: false });
    expect(await tab.read('window.activations')).toBe(0);
  });

  it('still reports ordinary formatting differences and fills a numeric field', async () => {
    await tab.show('<input id="wanted" aria-label="Wanted" oninput="this.value=this.value.toUpperCase()">');
    expect(await dispatchToHost(host, 'act', { action: 'type', uid: await wantedUid(), text: 'probe' })).toMatchObject({ ok: true, result: { value: 'PROBE' } });
    await tab.show('<input id="wanted" type="number" aria-label="Wanted" value="1">');
    expect(await dispatchToHost(host, 'act', { action: 'type', uid: await wantedUid(), text: '2' })).toMatchObject({ ok: true });
    expect(await tab.read('document.getElementById("wanted").value')).toBe('2');
  });

  it('checks takeover again after the target gains focus and before sending a key', async () => {
    await tab.show(`<input id="wanted" aria-label="Wanted" onfocus="console.log('focused')"><input id="other">
      <script>window.enters=0;document.addEventListener('keydown',e=>{if(e.key==='Enter')window.enters++});document.getElementById('other').focus()</script>`);
    const uid = await wantedUid();
    await tab.wc.debugger.sendCommand('Runtime.enable');
    tab.wc.debugger.on?.('message', (_event, method) => {
      if (method === 'Runtime.consoleAPICalled') host.takeOver();
    });
    expect(await dispatchToHost(host, 'key', { uid, key: 'Enter' })).toMatchObject({ ok: false });
    expect(await tab.read('window.enters')).toBe(0);
  });

  it('targets Enter at the requested field when its text is already present', async () => {
    await tab.show(`<input id="wanted" aria-label="Wanted" value="Plan API"><input id="other" aria-label="Other">
      <script>
        window.enters={wanted:0,other:0};
        for(const id of ['wanted','other'])document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')window.enters[id]++});
        document.getElementById('other').focus();
      </script>`);
    expect(await dispatchToHost(host, 'act', { action: 'type', uid: await wantedUid(), text: 'Plan API', submit: true })).toMatchObject({ ok: true });
    expect(await tab.read('window.enters')).toEqual({ wanted: 1, other: 0 });
  });

  it('does not send Enter after the typed field disappears', async () => {
    await tab.show(`<input aria-label="Wanted" oninput="this.remove()">
      <script>window.enters=0;document.addEventListener('keydown',e=>{if(e.key==='Enter')window.enters++})</script>`);
    expect(await dispatchToHost(host, 'act', { action: 'type', uid: await wantedUid(), text: 'Plan API', submit: true })).toMatchObject({ ok: false });
    expect(await tab.read('window.enters')).toBe(0);
  });

  it('respects takeover reported by a real input event before submitting', async () => {
    await tab.show(`<input id="wanted" aria-label="Wanted" oninput="console.log('typed')">
      <script>window.enters=0;document.addEventListener('keydown',e=>{if(e.key==='Enter')window.enters++})</script>`);
    const uid = await wantedUid();
    await tab.wc.debugger.sendCommand('Runtime.enable');
    // A real Chromium event schedules the person's takeover, without replacing
    // any CDP command or response with a test double.
    tab.wc.debugger.on?.('message', (_event, method) => {
      if (method === 'Runtime.consoleAPICalled') host.takeOver();
    });
    expect(await dispatchToHost(host, 'act', { action: 'type', uid, text: 'Plan API', submit: true })).toMatchObject({ ok: false });
    expect(await tab.read('document.getElementById("wanted").value')).toBe('Plan API');
    expect(await tab.read('window.enters')).toBe(0);
  });
});
