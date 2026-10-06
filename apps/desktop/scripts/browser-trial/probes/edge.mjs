// Walks the edge fixture with the bridge alone, no model: each step logs what the window answered.
// usage: node apps/desktop/scripts/browser-trial/run.mjs --out <dir> --probe apps/desktop/scripts/browser-trial/probes/edge.mjs --url fixture:edge.html

/** Each step is attempted on its own, so one failure does not hide what the next would have shown. */
export default async function probe(bridge, log) {
  const call = async (label, method, params = {}) => {
    try {
      const result = await bridge.call(method, params);
      log(`ok   ${label}`, summarize(result));
      return result;
    } catch (err) {
      log(`FAIL ${label}`, err instanceof Error ? err.message : String(err));
      return null;
    }
  };
  const read = async () =>
    (await bridge.call('eval', { expression: 'document.getElementById("result").textContent' }).catch(() => '')) ?? '';
  let text = '';
  const look = async () => {
    text = (await call('snapshot', 'snapshot', { full: true }))?.text ?? '';
  };
  const uid = (role, name) => new RegExp(`\\[(\\w+)\\] ${role}: "${name}\\s*"`).exec(text)?.[1];

  await look();
  log('iframe content in the tree:', /Example Domain/.test(text));

  await call('1. type Kamil into Imię', 'act', { action: 'type', uid: uid('textbox', 'Imię'), text: 'Kamil' });
  await call('2. select Kraków', 'select', { uid: uid('combobox', 'Miasto'), option: 'Kraków' });
  await call('3a. hover Menu', 'act', { action: 'hover', uid: uid('button', 'Menu') });
  await look();
  await call('3b. click Ustawienia', 'act', { action: 'click', uid: uid('button', 'Ustawienia') });
  await call('4. click Pokaż alert', 'act', { action: 'click', uid: uid('button', 'Pokaż alert') });
  await look();
  await call('5a. click Zapisz under the banner (expect refusal)', 'act', { action: 'click', uid: uid('button', 'Zapisz') });
  await call('5b. close the banner', 'act', { action: 'click', uid: uid('button', 'Zamknij promocję') });
  await look();
  await call('5c. click Zapisz', 'act', { action: 'click', uid: uid('button', 'Zapisz') });
  log('result line:', await read());
  const opened = await call('6. click Regulamin (target=_blank)', 'act', {
    action: 'click',
    uid: uid('link', 'Regulamin \\(nowa karta\\)'),
  });
  if (opened?.opened?.tabId) {
    const page = await call('6b. read the opened tab', 'snapshot', { tab_id: opened.opened.tabId, full: true });
    log('opened tab heading:', /heading: "([^"]+)"/.exec(page?.text ?? '')?.[1] ?? '(none)');
  }
  await call('tabs', 'tabs', { action: 'list' });
  await call('back to the test page', 'tabs', { action: 'select', tab_id: 't1' });
  await call('7. read the page with its frame', 'snapshot', { tab_id: 't1', full: true }).then((page) => {
    text = page?.text ?? '';
    const frame = text.slice(text.indexOf('Iframe: "Ramka testowa"'));
    log('frame heading:', /heading: "([^"]+)"/.exec(frame)?.[1] ?? '(none)');
  });
  await call('7b. click the link inside the frame', 'act', { tab_id: 't1', action: 'click', uid: uid('link', 'Learn more') });
}

function summarize(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return (text ?? '').replace(/\s+/g, ' ').slice(0, 260);
}
