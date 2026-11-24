// A sign-in through a popup, end to end, with the bridge alone: the page must end signed in, in the tab it started in.
// usage: node apps/desktop/scripts/browser-trial/run.mjs --out <dir> --probe apps/desktop/scripts/browser-trial/probes/oauth-popup.mjs --url fixture:oauth-popup.html
// Exits non-zero when the sign-in did not come back to the page that started it.
// PROBE_CANCEL=1 (with TRIAL_CLOSE_POPUP_MS set) checks the other way out: the person closes the popup unfinished,
// and the page that started it must stay where it was, signed out, ready to try again.

export default async function probe(bridge, log, { origin }) {
  const cancel = process.env.PROBE_CANCEL === '1';
  if (cancel) await bridge.call('goto', { url: `${origin}?hold` });
  const tabs = async () => (await bridge.call('tabs', { action: 'list' })).tabs ?? [];
  const resultOf = async (tabId) =>
    bridge.call('eval', { tab_id: tabId, expression: 'document.getElementById("result").textContent' }).catch((err) => `(${err.message})`);

  const page = await bridge.call('snapshot', { full: true });
  const uid = /\[(\w+)\] button: "Zaloguj przez Google\s*"/.exec(page.text ?? '')?.[1];
  if (!uid) throw new Error('no sign-in button on the page');
  const [start] = await tabs();
  log('start tab:', start.tabId, start.url);

  const click = await bridge.call('act', { action: 'click', uid });
  log('click reply:', { opened: click.opened ?? null, popup: click.popup ?? null });

  // Long enough for the provider step, the redirect back and the close.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const after = await tabs();
  log('tabs after:', after.map((tab) => `${tab.tabId} ${tab.url}`));
  for (const tab of after) log(`result in ${tab.tabId}:`, await resultOf(tab.tabId));
  const listed = await bridge.call('tabs', { action: 'list' });
  log('active tab:', listed.activeTabId ?? listed.active ?? '(not reported)');

  const noExtraTab = after.length === 1;
  if (cancel) {
    const cancelled = /logowanie anulowane/.test(await resultOf(start.tabId));
    const again = /Zaloguj przez Google/.test((await bridge.call('snapshot', { tab_id: start.tabId, full: true })).text ?? '');
    log(`VERDICT cancelled-in-start-tab=${cancelled} can-try-again=${again} no-extra-tab=${noExtraTab}`);
    if (!cancelled || !again || !noExtraTab) throw new Error('a cancelled sign-in did not leave the start tab ready to try again');
    return;
  }
  const signedIn = /zalogowano jako Kamil/.test(await resultOf(start.tabId));
  log(`VERDICT signed-in-in-start-tab=${signedIn} no-extra-tab=${noExtraTab}`);
  if (!signedIn || !noExtraTab) throw new Error('the sign-in did not come back to the tab that started it');
}
