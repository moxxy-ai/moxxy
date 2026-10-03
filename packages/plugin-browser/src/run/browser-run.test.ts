import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevError, RunMemory, type AppTree, type AskJev, type JevAnswers, type JevQuestion } from '@moxxy/jev';
import { describe, expect, it } from 'vitest';
import { formatRunReport, runBrowserSteps, type PageRead, type RunPort, type RunStep } from './browser-run.js';

/**
 * A small shop as the desktop's bridge would serve it: pages of elements under
 * uids, and what acting on each uid does. Jev is the one thing faked, as the
 * remote service it is: it answers from what each test says the page means.
 */

interface Element { readonly uid: number; readonly role: string; readonly title: string; readonly focused?: boolean; readonly value?: string }
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
};

type Effect = string | Error;

function shop(links: Record<number, Effect>, start = 'home') {
  let at = start;
  const acted: Array<{ do: string; uid?: string; text?: string; option?: string; key?: string }> = [];
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
          ...(element.value !== undefined ? { value: element.value } : {}),
          ...(element.focused ? { states: ['focused' as const] } : {}),
        })),
      };
      return { tabId: 't1', url: `https://books.toscrape.com/${at}`, title: page.title, tree, page: page.text } satisfies PageRead;
    },
    act: async (step, uid) => {
      acted.push({ do: step.do, ...(uid ? { uid } : {}), ...(step.text ? { text: step.text } : {}), ...(step.key ? { key: step.key } : {}) });
      const effect = uid ? links[Number(uid)] : undefined;
      if (effect instanceof Error) throw effect;
      if (effect) at = effect;
      return {};
    },
  };
  return { port, acted, at: () => at };
}

/** Jev, as far as these tests need it: which uid a target means, and whether a page shows what a step expects. */
function jev(meaning: { targets?: Record<string, number | 'none'>; shows?: (expect: string, page: string) => boolean }) {
  const requests: Array<{ state: Record<string, unknown>; questions: Record<string, JevQuestion> }> = [];
  const ask: AskJev = async (state, questions) => {
    const said = state as Record<string, unknown>;
    requests.push({ state: said, questions: { ...questions } });
    const answers: Record<string, JevAnswers[string]> = {};
    for (const [id, question] of Object.entries(questions)) {
      if (question.type === 'noul') {
        const performed = said.performed as RunStep;
        answers[id] = { type: 'noul', noul: meaning.shows?.(performed.expect ?? '', String(said.page)) ? 0.93 : 0.04 };
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
    const steps: RunStep[] = [{ do: 'click', target: 'the first book on the page' }];
    const first = jev({ targets: { 'the first book on the page': 6 } });

    const report = await runBrowserSteps({ goal: 'open a book', steps }, { port: shop({ 6: 'book' }).port, ask: first.ask, memory: remembered, signal });
    expect(report.outcomes[0]).toMatchObject({ status: 'done', found: 'jev', element: 'link "A Light in the Attic"' });
    expect(first.requests).toHaveLength(1);
    expect(String(first.requests[0]?.state.elements)).toContain('[6] link "A Light in the Attic"');

    const again = jev({});
    const site = shop({ 6: 'book' });
    const second = await runBrowserSteps({ goal: 'open a book', steps }, { port: site.port, ask: again.ask, memory: remembered, signal });
    expect(second.outcomes[0]).toMatchObject({ status: 'done', found: 'memory' });
    expect(site.acted).toEqual([{ do: 'click', uid: '6' }]);
    expect(again.requests).toHaveLength(0);
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
    expect(Object.keys(requests[0]?.questions ?? {}).sort()).toEqual(['expected', 'target']);
    expect(site.at()).toBe('book');
  });

  it('stops at a step whose expectation does not show, and does not run the rest', async () => {
    const site = shop({ 4: 'home', 6: 'book' });
    const { ask } = jev({ shows: () => false });

    const report = await runBrowserSteps(
      { goal: 'open Mystery', steps: [{ do: 'click', target: 'Mystery', expect: 'the Mystery category' }, { do: 'click', target: 'A Light in the Attic' }] },
      { port: site.port, ask, memory: memory(), signal },
    );

    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'not_run']);
    expect(report.outcomes[0]?.why).toMatch(/the Mystery category/);
    expect(site.acted).toHaveLength(1);
    expect(formatRunReport(report)).toMatch(/0 of 2 steps done/);
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
    expect(site.acted).toEqual([{ do: 'type', uid: '5', text: 'himalayas' }]);

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

  it('stops and says the key was refused when Jev answers 401', async () => {
    const ask: AskJev = async () => {
      throw new JevError(401, 'Jev returned HTTP 401');
    };
    const report = await runBrowserSteps({ goal: 'g', steps: [{ do: 'click', target: 'some book' }] }, { port: shop({}).port, ask, memory: memory(), signal });
    expect(report.stopped).toMatch(/TypeSafe key was refused/);
    expect(report.outcomes[0]?.status).toBe('not_run');
  });
});
