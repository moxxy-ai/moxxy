import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevError, RunMemory, type AppTree, type AskJev, type JevAnswers, type JevQuestion } from '@moxxy/jev';
import { describe, expect, it } from 'vitest';
import { formatRunReport, runBrowserSteps, runShortfall, shownText, stepProblem, type PageRead, type RunPort, type RunStep } from './browser-run.js';

/**
 * A small shop as the desktop's bridge would serve it: pages of elements under
 * uids, and what acting on each uid does. Jev is the one thing faked, as the
 * remote service it is: it answers from what each test says the page means.
 */

interface Element { readonly uid: number; readonly role: string; readonly title: string; readonly focused?: boolean; readonly value?: string; readonly readOnly?: boolean; readonly on?: boolean; readonly stuck?: boolean }
interface Page { readonly title: string; readonly elements: readonly Element[]; readonly text: string }

const PAGES: Record<string, Page> = {
  home: {
    title: 'All products',
    elements: [
      { uid: 3, role: 'link', title: 'Travel' },
      { uid: 4, role: 'link', title: 'Mystery' },
      { uid: 5, role: 'searchbox', title: 'Search', value: '', focused: true },
      { uid: 6, role: 'link', title: 'A Light in the Attic' },
      { uid: 7, role: 'button', title: 'Add to basket' },
    ],
    text: 'heading "All products"\nlink "Travel"\nlink "Mystery"\nlink "A Light in the Attic" £51.77',
  },
  travel: {
    title: 'Travel',
    elements: [
      { uid: 3, role: 'link', title: 'Travel' },
      { uid: 20, role: 'link', title: "It's Only the Himalayas" },
      { uid: 21, role: 'button', title: 'Add to basket' },
      { uid: 22, role: 'link', title: 'Full Moon over Noah’s Ark' },
      { uid: 23, role: 'button', title: 'Add to basket' },
    ],
    text: 'heading "Travel"\nlink "It\'s Only the Himalayas" £45.17\nlink "Full Moon over Noah’s Ark" £49.43',
  },
  book: {
    title: "It's Only the Himalayas",
    elements: [{ uid: 30, role: 'button', title: 'Add to basket' }],
    text: 'heading "It\'s Only the Himalayas"\n£45.17\nIn stock',
  },
  basket: { title: 'Basket', elements: [], text: 'heading "Basket"\n1 item' },
  settings: {
    title: 'Settings',
    elements: [
      { uid: 60, role: 'checkbox', title: 'E-mail', on: true },
      { uid: 61, role: 'checkbox', title: 'SMS', on: false },
      { uid: 62, role: 'button', title: 'Public profile', on: true },
      { uid: 63, role: 'button', title: 'Save' },
      // A box the page will not let go of: a click is delivered and changes nothing.
      { uid: 64, role: 'checkbox', title: 'Terms', on: false, stuck: true },
    ],
    text: 'heading "Settings"\ncheckbox "E-mail"\ncheckbox "SMS"\nbutton "Public profile"\nbutton "Save"',
  },
  account: {
    title: 'Account',
    elements: [
      { uid: 46, role: 'textbox', title: 'Display name', value: 'kamil123', readOnly: true },
      { uid: 50, role: 'button', title: 'Edit name' },
    ],
    text: 'heading "Account"\ntextbox "Display name"\nbutton "Edit name"',
  },
};

type Effect = string | Error | { readonly page?: string; readonly result: Record<string, unknown> };

/** `drops`: fields that throw away what is typed into them, the way a framework-controlled input can. */
function shop(links: Record<number, Effect>, start = 'home', drops: readonly number[] = []) {
  let at = start;
  const acted: Array<{ do: string; uid?: string; text?: string; option?: string; key?: string }> = [];
  const typed = new Map<number, string>();
  const flipped = new Set<number>();
  /** On, off, or neither: a box says "checked" or nothing, a toggle says which way it is, a plain button says nothing. */
  const onOff = (element: Element) => {
    if (element.on === undefined) return [];
    const on = element.on !== flipped.has(element.uid);
    return element.role === 'button' ? [on ? ('selected' as const) : ('not selected' as const)] : on ? ['checked' as const] : [];
  };
  const port: RunPort = {
    read: async () => {
      const page = PAGES[at] as Page;
      const tree: AppTree = {
        app: 'books.toscrape.com',
        window: page.title,
        elements: page.elements.map((element) => ({
          key: `/${element.role}[${element.uid}]`,
          index: element.uid,
          depth: 1,
          role: element.role,
          title: element.title,
          ...(element.value !== undefined ? { value: typed.get(element.uid) ?? element.value } : {}),
          ...(element.focused ? { states: ['focused' as const] } : element.readOnly ? { states: ['read-only' as const] } : onOff(element).length ? { states: onOff(element) } : {}),
        })),
      };
      return { tabId: 't1', url: `https://books.toscrape.com/${at}`, title: page.title, tree, page: page.text } satisfies PageRead;
    },
    act: async (step, uid) => {
      acted.push({ do: step.do, ...(uid ? { uid } : {}), ...(step.text ? { text: step.text } : {}), ...(step.key ? { key: step.key } : {}) });
      const locked = (PAGES[at] as Page).elements.some((element) => element.uid === Number(uid) && element.readOnly);
      if (step.do === 'type' && uid && !locked && !drops.includes(Number(uid))) typed.set(Number(uid), step.text ?? '');
      const pressed = (PAGES[at] as Page).elements.find((element) => element.uid === Number(uid));
      if (step.do === 'click' && pressed?.on !== undefined && !pressed.stuck && !flipped.delete(pressed.uid)) flipped.add(pressed.uid);
      const effect = uid ? links[Number(uid)] : undefined;
      if (effect instanceof Error) throw effect;
      if (typeof effect === 'string') at = effect;
      if (typeof effect === 'object') {
        if (effect.page) at = effect.page;
        return { result: effect.result };
      }
      return {};
    },
  };
  return { port, acted, at: () => at };
}

/** Jev, as far as these tests need it: which uid a target means, and whether a page shows what a step expects. */
function jev(meaning: { targets?: Record<string, number | 'none'>; shows?: (expect: string, page: string, state: Record<string, unknown>) => boolean }) {
  const requests: Array<{ state: Record<string, unknown>; questions: Record<string, JevQuestion> }> = [];
  const ask: AskJev = async (state, questions) => {
    const said = state as Record<string, unknown>;
    requests.push({ state: said, questions: { ...questions } });
    const answers: Record<string, JevAnswers[string]> = {};
    for (const [id, question] of Object.entries(questions)) {
      if (question.type === 'noul') {
        const performed = said.performed as RunStep;
        answers[id] = { type: 'noul', noul: meaning.shows?.(performed.expect ?? '', String(said.page), said) ? 0.93 : 0.04 };
        continue;
      }
      const step = said.step as RunStep;
      const meant = meaning.targets?.[step.target ?? ''] ?? 'none';
      const options = Object.keys(question.criteria);
      const choice = options.includes(String(meant)) ? String(meant) : 'none';
      answers[id] = { type: 'choice', choice, confidence: 0.9, probabilities: Object.fromEntries(options.map((option) => [option, option === choice ? 0.92 : 0.08 / options.length])) };
    }
    return answers;
  };
  return { ask, requests };
}

const memory = () => new RunMemory(mkdtempSync(join(tmpdir(), 'browser-run-')), () => 1_000);
const signal = new AbortController().signal;

describe('runBrowserSteps', () => {
  it('finds an element by its name without asking Jev, and remembers the way that worked', async () => {
    const site = shop({ 3: 'travel' });
    const remembered = memory();
    const { ask, requests } = jev({});

    const report = await runBrowserSteps({ goal: 'open Travel', steps: [{ do: 'click', target: 'Travel' }] }, { port: site.port, ask, memory: remembered, signal });

    expect(report.outcomes).toEqual([expect.objectContaining({ status: 'done', found: 'name', element: 'link "Travel"' })]);
    expect(site.acted).toEqual([{ do: 'click', uid: '3' }]);
    expect(requests).toHaveLength(0);
    expect((await remembered.read('books.toscrape.com')).routes).toEqual([expect.objectContaining({ goal: 'open Travel' })]);
  });

  it('asks Jev for a target described in words, and the next run on the site finds it from memory', async () => {
    const remembered = memory();
    const steps: RunStep[] = [{ do: 'click', target: 'the first book on the page', expect: 'the page of the book' }];
    const first = jev({ targets: { 'the first book on the page': 6 }, shows: () => true });

    const report = await runBrowserSteps({ goal: 'open a book', steps }, { port: shop({ 6: 'book' }).port, ask: first.ask, memory: remembered, signal });
    expect(report.outcomes[0]).toMatchObject({ status: 'done', found: 'jev', element: 'link "A Light in the Attic"' });
    expect(first.requests).toHaveLength(2);
    expect(String(first.requests[0]?.state.elements)).toContain('[6] link "A Light in the Attic"');

    const again = jev({ shows: () => true });
    const site = shop({ 6: 'book' });
    const second = await runBrowserSteps({ goal: 'open a book', steps }, { port: site.port, ask: again.ask, memory: remembered, signal });
    expect(second.outcomes[0]).toMatchObject({ status: 'done', found: 'memory' });
    expect(site.acted).toEqual([{ do: 'click', uid: '6' }]);
    // Jev is asked only whether the book opened, not where it is.
    expect(again.requests.map((request) => request.state.performed !== undefined)).toEqual([true]);
  });

  it("checks what a step expects in the same request that finds the next step's element", async () => {
    const site = shop({ 3: 'travel', 20: 'book' });
    const { ask, requests } = jev({ targets: { 'the Himalayas book': 20 }, shows: (expect, page) => expect === 'the Travel category' && page.includes('"Travel"') });

    const report = await runBrowserSteps(
      { goal: 'open the Himalayas book', steps: [{ do: 'click', target: 'Travel', expect: 'the Travel category' }, { do: 'click', target: 'the Himalayas book' }] },
      { port: site.port, ask, memory: memory(), signal },
    );

    expect(report.outcomes.map((outcome) => [outcome.status, outcome.checked])).toEqual([['done', true], ['done', undefined]]);
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {}).sort()).toEqual(['expected', 'expected_change', 'target']);
    expect(site.at()).toBe('book');
  });

  it('stops at a step whose expectation does not show, and does not run the rest', async () => {
    const site = shop({ 4: 'home', 6: 'book' });
    const { ask } = jev({ shows: () => false });

    const report = await runBrowserSteps(
      { goal: 'open Mystery', steps: [{ do: 'click', target: 'Mystery', expect: 'the Mystery category' }, { do: 'click', target: 'A Light in the Attic' }] },
      { port: site.port, ask, memory: memory(), signal },
    );

    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['unverified', 'not_run']);
    expect(report.outcomes[0]?.why).toMatch(/the Mystery category/);
    expect(site.acted).toHaveLength(1);
    const text = formatRunReport(report);
    expect(text).toMatch(/0 of 2 steps done/);
    expect(text).toMatch(/delivered, but "the Mystery category" was not seen/);
    expect(text).toMatch(/before doing it again/);
  });

  it('tells Jev what the action set off and what appeared and went away, not only the page after it', async () => {
    const site = shop({ 3: { page: 'travel', result: { dialog: { type: 'alert', message: 'Zapisano', accepted: true } } } });
    let seen: Record<string, unknown> = {};
    const { ask } = jev({
      shows: (_expect, _page, state) => {
        seen = state;
        return true;
      },
    });

    await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'Travel', expect: 'an alert' }] }, { port: site.port, ask, memory: memory(), signal });

    expect(seen.performed).toMatchObject({ do: 'click', result: { dialog: { type: 'alert', message: 'Zapisano' } } });
    expect(seen.changes).toMatchObject({
      appeared: expect.arrayContaining(['heading "Travel"']),
      went_away: expect.arrayContaining(['heading "All products"']),
    });
  });

  it('asks apart whether the change and whether the page show it, and takes either as seen', async () => {
    const site = shop({ 3: 'travel' });
    const asked: string[][] = [];
    const ask: AskJev = async (_state, questions) => {
      asked.push(Object.keys(questions).sort());
      return Object.fromEntries(
        Object.entries(questions).map(([id]) => [id, { type: 'noul', noul: id === 'expected_change' ? 0.9 : 0.2 }]),
      ) as JevAnswers;
    };

    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'Travel', expect: 'the promo goes away' }] }, { port: site.port, ask, memory: memory(), signal });

    expect(asked).toEqual([['expected', 'expected_change']]);
    expect(report.outcomes[0]).toMatchObject({ status: 'done', checked: true });
  });

  it('takes from each step only what its kind uses, since strict providers fill every field', async () => {
    const site = shop({ 3: 'travel' });
    const { ask, requests } = jev({});

    const report = await runBrowserSteps(
      {
        goal: 'g',
        steps: [
          { do: 'key', target: 'the alert', key: 'Enter', text: '', option: 'Kraków', submit: false },
          { do: 'click', target: 'Travel', text: '', option: 'Kraków', key: 'Enter', submit: false },
        ],
      },
      { port: site.port, ask, memory: memory(), signal },
    );

    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    expect(site.acted).toEqual([{ do: 'key', key: 'Enter' }, { do: 'click', uid: '3' }]);
    expect(requests).toHaveLength(0);
    expect(formatRunReport(report)).not.toMatch(/Kraków/);
  });

  it('forgets a remembered element that did not do its step', async () => {
    const remembered = memory();
    await remembered.learn('books.toscrape.com', { targets: [{ do: 'click', target: 'my book', key: '/link[6]', label: 'link\u001fA Light in the Attic', way: 0 }] });
    const { ask } = jev({ shows: () => false });

    await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'my book', expect: 'the book page' }] }, { port: shop({}).port, ask, memory: remembered, signal });

    expect((await remembered.read('books.toscrape.com')).targets).toEqual([]);
  });

  it('tries the next likely element when the first cannot be pressed', async () => {
    const site = shop({ 21: new Error('uid 21 (button "Add to basket") is covered by a cookie banner'), 23: 'basket' }, 'travel');
    const ask: AskJev = async (_state, questions) => ({
      target: { type: 'choice', choice: '21', confidence: 0.5, probabilities: Object.fromEntries(Object.keys((questions.target as { criteria: object }).criteria).map((o) => [o, o === '21' ? 0.55 : o === '23' ? 0.4 : 0])) },
    });

    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'add a Travel book to the basket' }] }, { port: site.port, ask, memory: memory(), signal });

    expect(report.outcomes[0]).toMatchObject({ status: 'done', found: 'jev' });
    expect(site.acted.map((act) => act.uid)).toEqual(['21', '23']);
  });

  it('stops at once when the site is not allowed or the person has the browser, without trying anything else', async () => {
    const refusal = new Error('The user has not allowed books.toscrape.com in this conversation yet, so nothing was done. Call browser_allow_site …');
    const site = shop({ 3: refusal });

    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'Travel' }, { do: 'click', target: 'Mystery' }] }, { port: site.port, ask: jev({}).ask, memory: memory(), signal });

    expect(report.stopped).toContain('browser_allow_site');
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'not_run']);
  });

  it('types into the field that has focus when a step names none, and says so when nothing has it', async () => {
    const site = shop({});
    const typed = await runBrowserSteps({ goal: 'g', steps: [{ do: 'type', text: 'himalayas', submit: true }] }, { port: site.port, ask: jev({}).ask, memory: memory(), signal });
    expect(typed.outcomes[0]).toMatchObject({ status: 'done', found: 'focus' });
    expect(site.acted).toEqual([{ do: 'type', uid: '5', text: 'himalayas' }, { do: 'key', uid: '5', key: 'Enter' }]);

    const nowhere = await runBrowserSteps({ goal: 'g', steps: [{ do: 'type', text: 'x' }] }, { port: shop({}, 'travel').port, ask: jev({}).ask, memory: memory(), signal });
    expect(nowhere.outcomes[0]?.why).toMatch(/nothing on the page has focus/i);
  });

  it('presses a key with no element to find', async () => {
    const site = shop({});
    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'key', key: 'Escape' }] }, { port: site.port, ask: jev({}).ask, memory: memory(), signal });
    expect(report.outcomes[0]).toMatchObject({ status: 'done' });
    expect(site.acted).toEqual([{ do: 'key', key: 'Escape' }]);
  });

  it('names the closest elements when Jev finds none', async () => {
    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'the checkout button' }] }, { port: shop({}).port, ask: jev({}).ask, memory: memory(), signal });
    expect(report.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(report.outcomes[0]?.why).toMatch(/could not find "the checkout button"/);
  });

  it('says the closest elements may be the one meant under another name', async () => {
    // Asked for a Redeploy button, a run named Restart as the closest twice; the
    // agent kept looking for the word and gave up with the change unapplied.
    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'the checkout button' }] }, { port: shop({}).port, ask: jev({}).ask, memory: memory(), signal });
    expect(report.outcomes[0]?.why).toMatch(/closest: .+ — one of these may be what you meant under another name/);
  });

  it('stops and says the key was refused when Jev answers 401', async () => {
    const ask: AskJev = async () => {
      throw new JevError(401, 'Jev returned HTTP 401');
    };
    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'some book' }] }, { port: shop({}).port, ask, memory: memory(), signal });
    expect(report.stopped).toMatch(/TypeSafe key was refused/);
    expect(report.outcomes[0]?.status).toBe('not_run');
  });

  /**
   * Coolify's settings: a run typed a domain into Description instead of Domains,
   * Jev saw the domain somewhere on the page and called it done, and the next run
   * typed it into Description again from memory. What a type step did is checked
   * on the field itself, and only a step whose effect was seen is remembered.
   */
  it('fails a type step whose field does not hold what was typed, and remembers nothing from it', async () => {
    const remembered = memory();
    const site = shop({}, 'home', [5]);
    const report = await runBrowserSteps(
      { goal: 'g', steps: [{ do: 'type', target: 'Search', text: 'himalayas', expect: 'the search field holds himalayas' }] },
      { port: site.port, ask: jev({ shows: () => true }).ask, memory: remembered, signal },
    );
    expect(report.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(report.outcomes[0]?.why).toMatch(/searchbox "Search" holds "", not what was typed/);
    expect((await remembered.read('books.toscrape.com')).targets).toEqual([]);
  });

  it('remembers a typed field once it holds the text', async () => {
    const remembered = memory();
    const report = await runBrowserSteps(
      { goal: 'g', steps: [{ do: 'type', target: 'the box to search books', text: 'himalayas' }] },
      { port: shop({}).port, ask: jev({ targets: { 'the box to search books': 5 } }).ask, memory: remembered, signal },
    );
    expect(report.outcomes[0]).toMatchObject({ status: 'done', found: 'jev' });
    expect((await remembered.read('books.toscrape.com')).targets).toEqual([expect.objectContaining({ do: 'type', key: '/searchbox[5]' })]);
  });

  it('does not remember an element Jev picked for a step nobody checked', async () => {
    const remembered = memory();
    await runBrowserSteps(
      { goal: 'g', steps: [{ do: 'click', target: 'the first book on the page' }] },
      { port: shop({ 6: 'book' }).port, ask: jev({ targets: { 'the first book on the page': 6 } }).ask, memory: remembered, signal },
    );
    expect((await remembered.read('books.toscrape.com')).targets).toEqual([]);
  });

  it('tells Jev which element the step acted on, so a check can see it was the wrong one', async () => {
    const { ask, requests } = jev({ targets: { 'the box to search books': 5 }, shows: () => true });
    await runBrowserSteps(
      { goal: 'g', steps: [{ do: 'type', target: 'the box to search books', text: 'x', expect: 'the search box holds x' }] },
      { port: shop({}).port, ask, memory: memory(), signal },
    );
    const check = requests.find((request) => request.state.performed !== undefined);
    expect(check?.state.performed).toMatchObject({ on: 'searchbox "Search"' });
  });
});

describe('formatRunReport — what a step typed', () => {
  const typed = (text: string) =>
    formatRunReport({
      site: 'mgmt.example',
      tabId: 't1',
      outcomes: [{ step: { do: 'type', target: 'Domains', text }, status: 'done', element: 'textbox "Domains"', found: 'name' }],
    });

  it('shows a typed address whole, port included', () => {
    // At 60 characters the report cut "…sslip.io:5678" to "…sslip.io": the agent
    // read that as the port not taken and went back to type it again, ten times.
    const address = 'http://n8n-hsg8k4cgcskck0088cwsg44o.135.125.131.111.sslip.io:5678';

    expect(typed(address)).toContain(JSON.stringify(address));
  });

  it('marks a long text as cut, never passing a part off as all of it', () => {
    const report = typed('x'.repeat(2_000));

    expect(report).toMatch(/… \(2000 characters\)/);
    expect(report.length).toBeLessThan(600);
  });
});

describe('shownText — a value quoted back to the agent', () => {
  it('quotes what a field holds whole, or says plainly how much there was', () => {
    // Also what "holds …, not what was typed" quotes: a field value cut without a
    // mark would read as the field holding only that much.
    expect(shownText('https://moxxy.example:5678')).toBe('"https://moxxy.example:5678"');
    expect(shownText('y'.repeat(300))).toMatch(/^"y{200}"… \(300 characters\)$/);
  });
});

/**
 * In a settings trial the agent sent `click "checkbox E-mail"` expecting
 * "E-mail stays on": the box was on already, so the click switched it off, and
 * the settings were saved without e-mail. A step that names the state wanted —
 * on or off — reads the element first and clicks only when it is the other way.
 */
describe('setting a box, a switch or a toggle on or off', () => {
  const run = (steps: RunStep[], site = shop({}, 'settings')) =>
    runBrowserSteps({ goal: 'settings', steps }, { port: site.port, ask: jev({}).ask, memory: memory(), signal }).then((report) => ({ report, site }));

  it('does not touch a box that is already the way it was asked for', async () => {
    const { report, site } = await run([{ do: 'check', target: 'E-mail' }, { do: 'uncheck', target: 'SMS' }]);

    expect(site.acted).toEqual([]);
    expect(report.outcomes).toMatchObject([
      { status: 'done', element: 'checkbox "E-mail"', checked: true, state: 'already on' },
      { status: 'done', element: 'checkbox "SMS"', checked: true, state: 'already off' },
    ]);
    expect(formatRunReport(report)).toContain('1. check "E-mail" — done (checkbox "E-mail", by its name; already on)');
  });

  it('clicks once when it is the other way, and reads that it changed', async () => {
    const { report, site } = await run([{ do: 'check', target: 'SMS' }, { do: 'uncheck', target: 'E-mail' }, { do: 'uncheck', target: 'Public profile' }]);

    expect(site.acted).toEqual([{ do: 'click', uid: '61' }, { do: 'click', uid: '60' }, { do: 'click', uid: '62' }]);
    expect(report.outcomes.map((outcome) => [outcome.status, outcome.checked])).toEqual([['done', true], ['done', true], ['done', true]]);
    expect(formatRunReport(report)).toContain('1. check "SMS" — done (checkbox "SMS", by its name; now on)');
  });

  it('takes the element as its own proof: what the step expects is not put to Jev, which could not see it better', async () => {
    const site = shop({}, 'settings');
    const { ask, requests } = jev({ shows: () => false });

    const report = await runBrowserSteps(
      { goal: 'settings', steps: [{ do: 'check', target: 'SMS', expect: 'SMS is on' }, { do: 'uncheck', target: 'SMS', expect: 'SMS is off' }] },
      { port: site.port, ask, memory: memory(), signal },
    );

    expect(requests).toEqual([]);
    expect(report.outcomes.map((outcome) => [outcome.status, outcome.state])).toEqual([['done', 'now on'], ['done', 'now off']]);
  });

  it('fails when the click did not change it, saying which way it still is', async () => {
    const { report, site } = await run([{ do: 'check', target: 'Terms' }, { do: 'click', target: 'Save' }]);

    expect(site.acted).toEqual([{ do: 'click', uid: '64' }]);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'not_run']);
    expect(report.outcomes[0]?.why).toBe('checkbox "Terms" is still off after the click');
  });

  it('refuses an element that does not say whether it is on or off, before clicking it', async () => {
    const { report, site } = await run([{ do: 'check', target: 'Save' }]);

    expect(site.acted).toEqual([]);
    expect(report.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(report.outcomes[0]?.why).toMatch(/button "Save" does not say whether it is on or off/);
  });

  it('needs a target', () => {
    expect(stepProblem({ do: 'check' })).toBe('a check step needs a target');
    expect(stepProblem({ do: 'uncheck' })).toBe('an uncheck step needs a target');
  });
});

describe('typing into a field the page keeps locked', () => {
  it('says the field is read-only and that the page has to unlock it, not only that the text did not land', async () => {
    const site = shop({}, 'account');

    const report = await runBrowserSteps(
      { goal: 'rename', steps: [{ do: 'type', target: 'Display name', text: 'Kamil M.' }] },
      { port: site.port, ask: jev({}).ask, memory: memory(), signal },
    );

    expect(report.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(report.outcomes[0]?.why).toMatch(/textbox "Display name" holds "kamil123", not what was typed/);
    expect(report.outcomes[0]?.why).toMatch(/it is read-only: use what the page offers to unlock it \(an Edit button beside it\), then type/);
  });
});

describe('runShortfall — what a run tells the loop it did not get done', () => {
  const send: RunStep = { do: 'click', target: 'Send', expect: 'a ticket number' };
  const base = { site: 'forms.example', tabId: 't1' };

  it('is nothing for a run that did every step', () => {
    expect(runShortfall({ ...base, outcomes: [{ step: send, status: 'done', checked: true }] })).toBeUndefined();
  });

  it('names the step that failed and why', () => {
    const shortfall = runShortfall({
      ...base,
      outcomes: [
        { step: { do: 'type', target: 'Name', text: 'Jan' }, status: 'done' },
        { step: send, status: 'failed', why: 'no element on the page reads like "Send"' },
        { step: { do: 'click', target: 'Close' }, status: 'not_run' },
      ],
    });

    expect(shortfall).toEqual({ what: 'step 2 of 3, click "Send": no element on the page reads like "Send"' });
  });

  it('marks a step that was delivered though its effect was not seen, so it is checked before it is sent again', () => {
    const shortfall = runShortfall({ ...base, outcomes: [{ step: send, status: 'unverified', why: 'delivered, but "a ticket number" was not seen' }] });

    expect(shortfall).toEqual({ what: 'step 1 of 1, click "Send": delivered, but "a ticket number" was not seen', unverified: true });
  });

  it('gives the reason the run stopped for a step that never ran', () => {
    const shortfall = runShortfall({ ...base, outcomes: [{ step: send, status: 'not_run' }], stopped: 'Jev could not be reached' });

    expect(shortfall).toEqual({ what: 'step 1 of 1, click "Send": Jev could not be reached' });
  });

  it('is nothing when the user is why it stopped: the site is not allowed, or they took the browser over', () => {
    const notAllowed = 'The user has not allowed forms.example in this conversation yet, so nothing was done. Call browser_allow_site …';
    const takenOver = 'The user has taken over the browser.';

    for (const stopped of [notAllowed, takenOver]) {
      expect(runShortfall({ ...base, outcomes: [{ step: send, status: 'failed', why: stopped }], stopped })).toBeUndefined();
      expect(runShortfall({ ...base, outcomes: [{ step: send, status: 'not_run' }], stopped })).toBeUndefined();
    }
  });
});

