import { describe, expect, it } from 'vitest';
import type { AppState } from '../backend/rpc.js';
import { ComputerUseError, type ActionResult } from '../contract/outcome.js';
import type { ComputerAction, RunStep } from '../contract/tools.js';
import type { AppElement } from '@moxxy/jev';
import { JevError, type AskJev, type JevAnswers, type JevQuestion } from '@moxxy/jev';
import { STATE_CHARS } from '@moxxy/jev';
import { describeRun, runShortfall, runSteps, type RunDeps } from './run.js';

const button = (index: number, title: string, extra: Partial<AppElement> = {}): AppElement =>
  ({ key: `w/${index}`, index, depth: 1, role: 'button', title, frame: { x: index * 100, y: 10, width: 80, height: 20 }, ...extra });

/** A window in memory: actions go to `react`, which may change the elements. */
function app(elements: AppElement[], react: (action: ComputerAction, elements: AppElement[]) => ActionResult | void = () => undefined) {
  const acted: ComputerAction[] = [];
  let looks = 0;
  const state = (): AppState => ({ tree: { app: 'Editor', window: 'Main', elements: [{ key: 'w', index: 0, depth: 0, role: 'window' }, ...elements.map((element) => ({ ...element }))] } });
  return {
    acted, state,
    get looks() { return looks; },
    observe: async () => { looks += 1; return state(); },
    act: async (action: ComputerAction) => {
      acted.push(action);
      return { result: react(action, elements) ?? { outcome: 'delivered' as const }, state: state() };
    },
  };
}

type Judgement = (state: { step?: RunStep; performed?: RunStep; elements: string }, id: string) => JevAnswers[string] | undefined;
const pick = (index: number | 'none', probability = 0.9): JevAnswers[string] =>
  ({ type: 'choice', choice: String(index), probabilities: { [String(index)]: probability }, confidence: probability });
const yes = (noul: number): JevAnswers[string] => ({ type: 'noul', noul });

/** Jev scripted per question; records what each request asked. */
function jev(judgement: Judgement) {
  const requests: Array<{ state: Record<string, unknown>; ids: string[] }> = [];
  const ask: AskJev = async (state, questions: Readonly<Record<string, JevQuestion>>) => {
    requests.push({ state: state as Record<string, unknown>, ids: Object.keys(questions) });
    return Object.fromEntries(Object.entries(questions).map(([id, question]) =>
      [id, judgement(state as never, id) ?? (question.type === 'choice' ? pick('none') : yes(0))]));
  };
  return { ask, requests };
}

const deps = (window: ReturnType<typeof app>, ask: AskJev): RunDeps =>
  ({ ask, observe: window.observe, act: window.act, selectAll: 'super+a', signal: new AbortController().signal });

describe('runSteps', () => {
  it('stops the remaining actions of a remembered way after a partial delivery with a human block', async () => {
    // The OS boundary can report delivery with a block; the runner must honor both.
    const field = button(1, 'Address', { role: 'text field', value: '' });
    const window = app([field], () => ({ outcome: 'delivered', code: 'user_intervened' }));
    const noJev: AskJev = async () => { throw new Error('A remembered exact target needs no external decision'); };
    const steps: RunStep[] = [{ do: 'fill', target: 'Address', text: 'new address' }];
    const report = await runSteps('Replace the address', steps, window.state(), {
      ...deps(window, noJev), known: () => ({ element: field, way: 1 }),
    });
    expect(window.acted).toEqual([{ action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 }]);
    expect(report.outcomes).toMatchObject([{ status: 'failed', code: 'user_intervened', unverified: true }]);
    expect(runShortfall(report, steps)).toBeUndefined();
  });

  it('finds each element on the live window and acts on it, one decision per step', async () => {
    const window = app([button(1, 'Export'), button(2, 'Cancel')], (action, elements) => {
      if (action.action === 'click' && action.element_index === 1) elements.push(button(3, 'Save'));
      if (action.action === 'click' && action.element_index === 3) elements.push(button(4, 'Saved'));
    });
    const { ask, requests } = jev((state, id) => {
      if (id !== 'target') return undefined;
      return state.step?.target === 'the button that exports the clip' ? pick(1) : state.elements.includes('"Save"') ? pick(3) : pick('none');
    });
    const report = await runSteps('Export the clip', [{ do: 'click', target: 'the button that exports the clip' }, { do: 'click', target: 'the button that saves it' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([
      { action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 },
      { action: 'click', element_index: 3, mouse_button: 'left', click_count: 1 },
    ]);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    expect(report.outcomes[0]?.element).toBe('[1] button "Export"');
    // The second step's element is asked for in the request that follows the first action.
    expect(requests.map((request) => request.ids)).toEqual([['target'], ['target']]);
    expect(requests[0]?.state).toMatchObject({ goal: 'Export the clip', app: 'Editor', step: { do: 'click', target: 'the button that exports the clip' } });
    expect(report.asks).toBe(2);
    expect(report.state.tree.elements).toHaveLength(5);
  });

  it('says where its time went: Jev, the actions and the looks at the window', async () => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const window = app([button(1, 'Export')]);
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'the Export button' }], window.state(), {
      ...deps(window, ask),
      ask: async (...args) => { await pause(30); return ask(...args); },
      act: async (action) => { await pause(20); return window.act(action); },
    });
    expect(report.time.jev).toBeGreaterThanOrEqual(25);
    expect(report.time.act).toBeGreaterThanOrEqual(15);
    expect(report.time.look).toBeGreaterThanOrEqual(0);
    expect(report.time.jev + report.time.act + report.time.look).toBeLessThanOrEqual(report.ms + 1);
  });

  // Jev reads elements; a picture is what shows a click that changed only pixels, and what the model reads at the end.
  it('asks for a picture of the window only around clicks and at the end', async () => {
    const window = app([button(1, 'Note', { role: 'text area', value: '' }), button(2, 'Send')], (action, elements) => {
      if (action.action === 'type_text') (elements[0] as AppElement).value += action.text;
      if (action.action === 'click') elements.push(button(3, 'Sent'));
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(2) : undefined));
    const pictures: Array<[string, boolean | undefined]> = [];
    const looks: Array<boolean | undefined> = [];
    const steps: RunStep[] = [{ do: 'type', text: 'hi' }, { do: 'key', key: 'Tab' }, { do: 'click', target: 'Send' }, { do: 'key', key: 'Return' }];
    await runSteps('Send', steps, window.state(), {
      ...deps(window, ask),
      observe: async (picture) => { looks.push(picture); return window.observe(); },
      act: async (action, { picture }) => { pictures.push([action.action, picture]); return window.act(action); },
    });
    expect(pictures).toEqual([['type_text', false], ['press_key', true], ['click', true], ['press_key', true]]);
    expect(looks).toEqual([]);
  });

  it('judges a key that expects something by its picture too: selecting text changes pixels and no element', async () => {
    let selected = false;
    const field = button(1, 'Address', { role: 'text field', value: 'olx.pl', states: ['focused'] });
    const look = (picture: boolean): AppState => ({
      tree: { app: 'Safari', window: 'OLX', elements: [{ key: 'w', index: 0, depth: 0, role: 'window' }, field] },
      ...(picture ? { screenshot: { mediaType: 'image/jpeg', base64: selected ? 'c2VsZWN0ZWQ=' : 'cGxhaW4=', width: 10, height: 10 } } : {}),
    });
    const { ask } = jev((_state, id) => (id === 'expected' ? yes(0.4) : undefined));
    const steps: RunStep[] = [{ do: 'key', key: 'super+l' }, { do: 'key', key: 'super+a', expect: 'the address is selected' }, { do: 'key', key: 'Tab' }, { do: 'key', key: 'Tab' }];
    const report = await runSteps('Select the address', steps, look(true), {
      ask, signal: new AbortController().signal, observe: async (picture = true) => look(picture),
      act: async (action, { picture }) => {
        if (action.action === 'press_key' && action.key === 'super+a') selected = true;
        return { result: { outcome: 'delivered' }, state: look(picture) };
      },
    });
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('keeps what it shows Jev within its input limit when a long page changes as a whole', async () => {
    // The first click changes every listing of the page; the second opens another page.
    let clicks = 0;
    const listing = (index: number) => button(index, `listing ${index} seen ${clicks} ${'x'.repeat(60)}`, { role: 'link' });
    const look = (): AppState => ({ tree: { app: 'Safari', window: clicks < 2 ? 'Listings' : 'Listing', elements: [{ key: 'w', index: 0, depth: 0, role: 'window' }, ...Array.from({ length: 900 }, (_, at) => listing(at + 1))] } });
    const sizes: number[] = [];
    const ask: AskJev = async (state, questions) => {
      const { elements, changes } = state as { elements: string; changes?: string };
      sizes.push(elements.length + (changes?.length ?? 0));
      return Object.fromEntries(Object.keys(questions).map((id) => [id, id.startsWith('target') ? pick(1) : yes(id === 'expected' ? 0.9 : 0)]));
    };
    const steps: RunStep[] = [{ do: 'click', target: 'the first listing', expect: 'the listing opens' }, { do: 'click', target: 'the first listing', expect: 'the listing opens' }];
    await runSteps('Open', steps, look(), {
      ask, signal: new AbortController().signal, observe: async () => look(),
      act: async () => { clicks += 1; return { result: { outcome: 'delivered' }, state: look() }; },
    });
    expect(clicks).toBe(2);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(STATE_CHARS);
  });

  describe('steps that check nothing and need no element', () => {
    const typing = () => app([button(1, 'Address', { role: 'text field', value: '', states: ['focused'] })], (action, elements) => {
      if (action.action === 'type_text') (elements[0] as AppElement).value += action.text;
    });

    it('go to the helper together, with one state at the end', async () => {
      const window = typing();
      const batches: ComputerAction[][] = [];
      const { ask } = jev((_state, id) => (id === 'expected' ? yes(0.9) : undefined));
      const steps: RunStep[] = [{ do: 'key', key: 'super+l' }, { do: 'type', text: 'olx.pl' }, { do: 'key', key: 'Return', expect: 'OLX opens' }];
      const report = await runSteps('Open OLX', steps, window.state(), {
        ...deps(window, ask),
        batch: async (actions) => { batches.push([...actions]); for (const action of actions) await window.act(action); return { results: actions.map(() => ({ outcome: 'delivered' as const })), state: window.state() }; },
      });
      expect(batches).toEqual([[{ action: 'press_key', key: 'super+l', repeat: 1 }, { action: 'type_text', text: 'olx.pl' }]]);
      expect(window.acted.at(-1)).toEqual({ action: 'press_key', key: 'Return', repeat: 1 });
      expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done', 'verified']);
    });

    it('stop at the first one the helper did not deliver', async () => {
      const window = typing();
      const steps: RunStep[] = [{ do: 'key', key: 'super+l' }, { do: 'type', text: 'a' }, { do: 'type', text: 'b' }];
      const report = await runSteps('Type', steps, window.state(), {
        ...deps(window, jev(() => undefined).ask),
        batch: async () => ({ results: [{ outcome: 'delivered' }, { outcome: 'blocked', code: 'target_blocked' }], state: window.state() }),
      });
      expect(report.outcomes).toMatchObject([{ status: 'done' }, { status: 'failed', why: 'blocked (target_blocked)' }]);
    });

    it('stop at a step the helper did not report on instead of sending it again', async () => {
      const window = typing();
      let batches = 0;
      const steps: RunStep[] = [{ do: 'key', key: 'super+l' }, { do: 'type', text: 'a' }];
      const report = await runSteps('Type', steps, window.state(), {
        ...deps(window, jev(() => undefined).ask),
        batch: async () => { batches += 1; return { results: [{ outcome: 'delivered' }], state: window.state() }; },
      });
      expect(batches).toBe(1);
      expect(window.acted).toEqual([]);
      expect(report.outcomes).toMatchObject([{ status: 'done' }, { status: 'failed', why: 'the helper did not say whether this step was done' }]);
    });
  });

  it('acts on the one element named exactly as the target without asking Jev where it is', async () => {
    const window = app([button(1, 'Export'), button(2, 'Cancel')], (action, elements) => {
      if (action.action === 'click' && action.element_index === 1) elements.push(button(3, 'Saved'));
    });
    const { ask, requests } = jev((_state, id) => (id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'Export button', expect: 'saved' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([{ action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 }]);
    expect(requests.flatMap((request) => request.ids)).not.toContain('target');
    expect(report.outcomes).toMatchObject([{ status: 'verified', element: '[1] button "Export"' }]);
  });

  it('asks Jev where the element is when the one named as the target does not do the step', async () => {
    const window = app([button(1, 'Export'), button(2, 'Export as file')], (action, elements) => {
      if (action.action === 'click' && action.element_index === 2) elements.push(button(3, 'Saved'));
    });
    const { ask, requests } = jev((state, id) => (id === 'target' ? pick(2) : id === 'expected' ? yes(state.elements.includes('"Saved"') ? 0.9 : 0) : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'Export', expect: 'saved' }], window.state(), deps(window, ask));
    expect(window.acted.map((action) => 'element_index' in action && action.element_index)).toEqual([1, 2]);
    expect(requests.map((request) => request.ids)).toEqual([['already'], ['expected'], ['target', 'already'], ['expected']]);
    expect(report.outcomes).toMatchObject([{ status: 'verified', element: '[2] button "Export as file"' }]);
    expect(report.outcomes[0]).not.toHaveProperty('stale');
  });

  it('asks Jev nothing for keys and typing into the focus', async () => {
    const window = app([button(1, 'Note', { role: 'text area', value: '' })], (action, elements) => {
      if (action.action === 'type_text') (elements[0] as AppElement).value = action.text;
    });
    const { ask, requests } = jev(() => undefined);
    const report = await runSteps('Type', [{ do: 'type', text: 'hello' }, { do: 'key', key: 'Return' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([{ action: 'type_text', text: 'hello' }, { action: 'press_key', key: 'Return', repeat: 1 }]);
    expect(requests).toEqual([]);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done']);
  });

  it('does not click again when a click at a point changed only the screenshot: a menu the elements do not list would close', async () => {
    const acted: ComputerAction[] = [];
    let open = false;
    const state = (): AppState => ({
      tree: { app: 'Safari', window: 'Listings', elements: [{ key: 'w', index: 0, depth: 0, role: 'window' }, button(1, 'Sort'), button(2, 'Sort label')] },
      screenshot: { mediaType: 'image/jpeg', base64: open ? 'b3Blbg==' : 'Y2xvc2Vk', width: 10, height: 10 },
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Sort the listings', [{ do: 'click', target: 'the sort menu', expect: 'the sort options show' }], state(), {
      ask, selectAll: 'super+a', signal: new AbortController().signal, observe: async () => state(),
      act: async (action) => {
        acted.push(action);
        // Only a real click reaches the page's menu, and every one toggles it.
        if (action.action === 'click' && 'x' in action) open = !open;
        return { result: { outcome: 'delivered' }, state: state() };
      },
    });
    expect(acted).toEqual([
      { action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 },
      { action: 'click', x: 140, y: 20, mouse_button: 'left', click_count: 1 },
    ]);
    expect(open).toBe(true);
    expect(report.outcomes).toMatchObject([{ status: 'failed', attempts: 2, why: expect.stringMatching(/screenshot/) }]);
    expect(report.state.screenshot?.base64).toBe('b3Blbg==');
  });

  it('skips a step whose expected result already shows', async () => {
    const window = app([button(1, 'Export')]);
    const { ask } = jev((_state, id) => (id === 'already' ? yes(0.95) : id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Open export', [{ do: 'click', target: 'Export', expect: 'the export dialog is open' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([]);
    expect(report.outcomes).toMatchObject([{ status: 'skipped', attempts: 0 }]);
  });

  it('checks what a step expects and marks it verified', async () => {
    const window = app([button(1, 'Export')], (_action, elements) => { elements.push(button(2, 'Dialog')); });
    const { ask, requests } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Open export', [{ do: 'click', target: 'the button that exports', expect: 'a dialog is open' }], window.state(), deps(window, ask));
    expect(report.outcomes).toMatchObject([{ status: 'verified', attempts: 1 }]);
    expect(requests.map((request) => request.ids)).toEqual([['target', 'already'], ['expected']]);
    expect(requests[1]?.state).toMatchObject({ performed: { do: 'click', target: 'the button that exports' } });
    expect(String(requests[1]?.state.changes)).toContain('+ [2] button "Dialog"');
  });

  it('tries the next way when the first one changes nothing', async () => {
    const window = app([button(1, 'Export')], (action, elements) => {
      if (action.action === 'click' && action.x !== undefined) elements.push(button(2, 'Dialog'));
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Open export', [{ do: 'click', target: 'the button that exports' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([
      { action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 },
      { action: 'click', x: 140, y: 20, mouse_button: 'left', click_count: 1 },
    ]);
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 2 }]);
  });

  it('sets a value the long way when the field does not take it directly', async () => {
    const window = app([button(1, 'Name', { role: 'text field', value: 'old' })], (action, elements) => {
      if (action.action === 'set_value') return { outcome: 'unsupported', code: 'unsupported_action' };
      if (action.action === 'type_text') (elements[0] as AppElement).value = action.text;
      return undefined;
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Rename', [{ do: 'set_value', target: 'the name field', text: 'new' }], window.state(), deps(window, ask));
    expect(window.acted.map((action) => action.action)).toEqual(['set_value', 'click', 'press_key', 'type_text']);
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 2 }]);
    expect(report.state.tree.elements[1]?.value).toBe('new');
  });

  it('moves to the next best element when every way on the first fails, then stops and leaves the rest', async () => {
    const window = app([button(1, 'Export'), button(2, 'Export all')]);
    const { ask } = jev((_state, id) => (id === 'target' ? { type: 'choice', choice: '1', probabilities: { 1: 0.6, 2: 0.3, none: 0.1 }, confidence: 0.5 } : undefined));
    const steps: RunStep[] = [{ do: 'click', target: 'Export' }, { do: 'key', key: 'Return' }];
    const report = await runSteps('Export', steps, window.state(), deps(window, ask));
    expect(window.acted.map((action) => ('element_index' in action ? action.element_index : 'point'))).toEqual([1, 'point', 2, 'point']);
    expect(report.outcomes).toMatchObject([{ status: 'failed', attempts: 4, why: 'nothing changed' }]);
    expect(describeRun(report, steps)).toMatch(/0 of 2 steps[\s\S]*1\. FAILED[\s\S]*nothing changed[\s\S]*Not run: step 2/);
  });

  it('looks once more when no element matches, then names the closest ones', async () => {
    const window = app([button(1, 'Import')]);
    const { ask } = jev((_state, id) => (id === 'target' ? { type: 'choice', choice: 'none', probabilities: { none: 0.8, 1: 0.2 }, confidence: 0.6 } : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'Export' }], window.state(), deps(window, ask));
    expect(window.looks).toBe(1);
    expect(window.acted).toEqual([]);
    expect(report.outcomes).toMatchObject([{ status: 'failed', attempts: 0, why: 'no element matches', closest: ['[1] button "Import"'] }]);
  });

  it('clicks the text the screenshot shows when no element carries that name', async () => {
    const window = app([button(1, 'Title, Heading')], (action, elements) => {
      if (action.action === 'click' && 'x' in action) elements.push(button(2, 'Heading added'));
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick('none') : undefined));
    let reads = 0;
    const report = await runSteps('Add a title', [{ do: 'click', target: 'przycisk „Dodaj tytuł”' }], window.state(), {
      ...deps(window, ask),
      readText: async () => { reads += 1; return [{ text: 'Dodaj tytul', x: 100, y: 20, width: 80, height: 20 }]; },
    });
    expect(window.acted).toEqual([{ action: 'click', x: 140, y: 30, mouse_button: 'left', click_count: 1 }]);
    expect(reads).toBe(1);
    expect(report.outcomes).toMatchObject([{ status: 'done', element: 'text "Dodaj tytul" in the screenshot at 140,30' }]);
  });

  it('still fails when the screenshot does not read as the target either', async () => {
    const window = app([button(1, 'Import')]);
    const { ask } = jev((_state, id) => (id === 'target' ? pick('none') : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'Export' }], window.state(), {
      ...deps(window, ask), readText: async () => [{ text: 'Import', x: 0, y: 0, width: 50, height: 20 }],
    });
    expect(window.acted).toEqual([]);
    expect(report.outcomes).toMatchObject([{ status: 'failed', why: 'no element matches' }]);
  });

  it('stops at once when the user takes over', async () => {
    const window = app([button(1, 'Export')], () => ({ outcome: 'blocked', code: 'user_intervened' }));
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'Export' }], window.state(), deps(window, ask));
    expect(window.acted).toHaveLength(1);
    expect(report.outcomes).toMatchObject([{ status: 'failed', why: 'blocked (user_intervened)' }]);
  });

  it('treats a refused action as a failed way and looks again before the next one', async () => {
    const window = app([button(1, 'Export')]);
    let refused = false;
    const act: RunDeps['act'] = async (action) => {
      if (!refused) { refused = true; throw new ComputerUseError('stale_state', 'Index 1 is from an older state'); }
      return window.act(action);
    };
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Export', [{ do: 'key', key: 'Return' }, { do: 'click', target: 'Export' }], window.state(), { ...deps(window, ask), act });
    expect(window.looks).toBe(1);
    expect(report.outcomes[0]).toMatchObject({ status: 'failed', why: 'blocked (stale_state)' });
  });

  // Jev reads one window: a window or tab that is new looks like any other, so it is never sure the key worked.
  it('goes on after a key that brought another window to the front, without pressing it again', async () => {
    let front = 'Listings';
    const state = (): AppState => ({ tree: { app: 'Safari', window: front, elements: [{ key: `w/${front}`, index: 0, depth: 0, role: 'window', title: front }] } });
    const { ask } = jev((_state, id) => (id === 'expected' ? yes(0.2) : undefined));
    const acted: ComputerAction[] = [];
    const steps: RunStep[] = [{ do: 'key', key: 'super+n', expect: 'a new window is open' }, { do: 'key', key: 'super+l' }];
    const report = await runSteps('Open a new window', steps, state(), {
      ask, selectAll: 'super+a', signal: new AbortController().signal, observe: async () => state(),
      act: async (action) => { acted.push(action); if (action.action === 'press_key') front = 'Start Page'; return { result: { outcome: 'delivered' }, state: state() }; },
    });
    expect(acted.map((action) => action.action)).toEqual(['press_key', 'press_key']);
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 1 }, { status: 'done' }]);
  });

  // An empty new window reads like the empty one in front before it ("Start Page"): only its id tells them apart.
  it('goes on after a key that brought another window with the same title to the front', async () => {
    let id = '101';
    const state = (): AppState => ({ tree: { app: 'Safari', window: 'Start Page', windowId: id, elements: [{ key: 'w/start', index: 0, depth: 0, role: 'window', title: 'Start Page' }] } });
    const { ask } = jev((_state, question) => (question === 'expected' ? yes(0.2) : undefined));
    const acted: ComputerAction[] = [];
    const report = await runSteps('Open a new window', [{ do: 'key', key: 'super+n', expect: 'a new window is open' }], state(), {
      ask, selectAll: 'super+a', signal: new AbortController().signal, observe: async () => state(),
      act: async (action) => { acted.push(action); id = '102'; return { result: { outcome: 'delivered' }, state: state() }; },
    });
    expect(acted).toHaveLength(1);
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 1 }]);
  });

  // A new tab stays in its window: the number is the same, the title is the new tab's.
  it('goes on after a key that brought another tab of the same window to the front', async () => {
    let front = 'Kraków – Wikipedia';
    const state = (): AppState => ({ tree: { app: 'Safari', window: front, windowId: '101', elements: [{ key: 'w/tab', index: 0, depth: 0, role: 'window', title: front }] } });
    const { ask } = jev((_state, question) => (question === 'expected' ? yes(0.2) : undefined));
    const report = await runSteps('Open a new tab', [{ do: 'key', key: 'super+t', expect: 'a new tab is open' }], state(), {
      ask, selectAll: 'super+a', signal: new AbortController().signal, observe: async () => state(),
      act: async () => { front = 'Start Page'; return { result: { outcome: 'delivered' }, state: state() }; },
    });
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 1 }]);
  });

  it('stops at a key whose result does not show while the same window stays in front', async () => {
    const window = app([button(1, 'Export')]);
    const { ask } = jev((_state, id) => (id === 'expected' ? yes(0.1) : undefined));
    const report = await runSteps('Export', [{ do: 'key', key: 'super+e', expect: 'an export dialog is open' }], window.state(), deps(window, ask));
    expect(window.acted).toHaveLength(1);
    expect(report.outcomes).toMatchObject([{ status: 'failed', attempts: 1 }]);
  });

  // Typing again appends: "https://olx.plhttps://olx.pl".
  it('does not type again once the text is in the field, whatever else the step expects', async () => {
    const window = app([button(1, 'Address', { role: 'text field', value: '' })], (action, elements) => {
      if (action.action === 'type_text') (elements[0] as AppElement).value += action.text;
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.1) : undefined));
    const report = await runSteps('Open OLX', [{ do: 'type', target: 'the address field', text: 'https://olx.pl', expect: 'OLX opens' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([{ action: 'type_text', element_index: 1, text: 'https://olx.pl' }]);
    expect(report.state.tree.elements[1]?.value).toBe('https://olx.pl');
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 1 }]);
  });

  it('does not type into a field that already holds exactly the text: it would append it a second time', async () => {
    const window = app([button(1, 'Address', { role: 'text field', value: 'https://www.olx.pl', states: ['focused'] })], (action, elements) => {
      if (action.action === 'type_text') (elements[0] as AppElement).value += action.text;
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.1) : undefined));
    const steps: RunStep[] = [{ do: 'type', target: 'the address field', text: 'https://www.olx.pl', expect: 'OLX opens' }, { do: 'key', key: 'Return' }];
    const report = await runSteps('Open OLX', steps, window.state(), deps(window, ask));
    expect(window.acted).toEqual([{ action: 'press_key', key: 'Return', repeat: 1 }]);
    expect(report.outcomes).toMatchObject([{ status: 'skipped', attempts: 0 }, { status: 'done' }]);
    expect(describeRun(report, steps)).toContain('the field already holds this text');
  });

  it('types the other way when the first left the field without the text', async () => {
    const window = app([button(1, 'Address', { role: 'text field', value: '' })], (action, elements) => {
      if (action.action === 'type_text' && action.element_index === undefined) (elements[0] as AppElement).value += action.text;
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Open OLX', [{ do: 'type', target: 'the address field', text: 'https://olx.pl' }], window.state(), deps(window, ask));
    expect(window.acted.map((action) => action.action)).toEqual(['type_text', 'click', 'type_text']);
    expect(report.state.tree.elements[1]?.value).toBe('https://olx.pl');
    expect(report.outcomes).toMatchObject([{ status: 'done', attempts: 2 }]);
  });

  it('hands back to the main model when Jev cannot be asked', async () => {
    const window = app([button(1, 'Export')]);
    const ask: AskJev = async () => { throw new JevError(401, 'Jev returned HTTP 401'); };
    const report = await runSteps('Export', [{ do: 'click', target: 'the button that exports' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([]);
    expect(report.outcomes).toMatchObject([{ status: 'failed', why: 'Jev returned HTTP 401' }]);
  });
});

describe('a result that shows late', () => {
  it('is looked for once more before another way is tried', async () => {
    const elements = [button(1, 'Privacy')];
    const window = app(elements);
    const late = async () => { if (window.acted.length > 0 && elements.length === 1) elements.push(button(2, 'Privacy pane')); return window.observe(); };
    const { ask, requests } = jev((state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(state.elements.includes('Privacy pane') ? 0.9 : 0.1) : undefined));
    const report = await runSteps('Open Privacy', [{ do: 'click', target: 'the Privacy item of the sidebar', expect: 'the Privacy pane shows' }], window.state(), { ...deps(window, ask), observe: late });
    expect(window.acted).toHaveLength(1);
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', attempts: 1 });
    expect(requests.map((request) => request.ids)).toEqual([['target', 'already'], ['expected'], ['expected']]);
  });

  it('is not waited for twice: a step that still does not show its result goes another way', async () => {
    const window = app([button(1, 'Privacy')]);
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Open Privacy', [{ do: 'click', target: 'Privacy', expect: 'the Privacy pane shows' }], window.state(), deps(window, ask));
    expect(window.acted).toHaveLength(2);
    expect(window.looks).toBe(2);
    expect(report.outcomes[0]?.status).toBe('failed');
  });
});

describe('what was learned before', () => {
  it('acts on a remembered element without asking where it is', async () => {
    const window = app([button(1, 'Export'), button(2, 'Cancel')], (_action, elements) => { elements.push(button(3, 'Sheet')); });
    const { ask, requests } = jev(() => undefined);
    const known: RunDeps['known'] = (step, tree) => (step.target === 'Export' ? { element: tree.elements[1] as AppElement, way: 0 } : undefined);
    const report = await runSteps('Export', [{ do: 'click', target: 'Export' }], window.state(), { ...deps(window, ask), known });
    expect(window.acted).toEqual([{ action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 }]);
    expect(requests).toEqual([]);
    expect(report.outcomes[0]).toMatchObject({ status: 'done', recalled: true });
  });

  it('starts with the way that worked last time', async () => {
    const window = app([button(1, 'Export')], (_action, elements) => { elements.push(button(3, 'Sheet')); });
    const { ask } = jev(() => undefined);
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 1 });
    await runSteps('Export', [{ do: 'click', target: 'Export' }], window.state(), { ...deps(window, ask), known });
    expect(window.acted).toEqual([{ action: 'click', x: 140, y: 20, mouse_button: 'left', click_count: 1 }]);
  });

  it('reports what a verified step used, so it can be remembered', async () => {
    const window = app([button(1, 'Export')], (action, elements) => { if (action.action === 'click') elements.push(button(2, 'Sheet')); });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Export', [{ do: 'click', target: 'Export', expect: 'the sheet shows' }], window.state(), deps(window, ask));
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', used: { key: 'w/1', label: 'button\u001fExport', way: 0 } });
    expect(report.outcomes[0]?.recalled).toBeUndefined();
  });

  it('asks Jev again when the remembered element no longer does it, and says the memory is stale', async () => {
    const window = app([button(1, 'Export'), button(2, 'Old')], (action, elements) => {
      if (action.action === 'click' && action.element_index === 1) elements.push(button(3, 'Sheet'));
    });
    const { ask, requests } = jev((state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(state.elements.includes('"Sheet"') ? 0.9 : 0) : undefined));
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[2] as AppElement, way: 0 });
    const report = await runSteps('Export', [{ do: 'click', target: 'the button that exports', expect: 'the sheet shows' }], window.state(), { ...deps(window, ask), known });
    expect(window.acted.map((action) => (action as { element_index?: number }).element_index)).toEqual([2, 1]);
    expect(requests.map((request) => request.ids)).toEqual([['already'], ['expected'], ['target', 'already'], ['expected']]);
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', stale: true, used: { key: 'w/1' } });
  });
});

describe('what a step showed last time', () => {
  const sheet = 'button\u001fSheet';
  const opens = () => app([button(1, 'Export')], (action, elements) => { if (action.action === 'click') elements.push(button(2, 'Sheet')); });
  const step = { do: 'click' as const, target: 'Export', expect: 'the sheet shows' };

  it('is reported with a verified step', async () => {
    const window = opens();
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Export', [step], window.state(), deps(window, ask));
    expect(report.outcomes[0]?.used).toEqual({ key: 'w/1', label: 'button\u001fExport', way: 0, effect: [sheet] });
  });

  it('checks a remembered step without Jev when the same shows again', async () => {
    const window = opens();
    const { ask, requests } = jev(() => undefined);
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, ask), known });
    expect(requests).toEqual([]);
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', recalled: true, used: { key: 'w/1', effect: [sheet] } });
    expect(report.asks).toBe(0);
  });

  it('tells the action what to wait for, so it can return the moment that shows', async () => {
    const window = opens();
    const { ask } = jev(() => undefined);
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });
    const waited: Array<readonly string[] | undefined> = [];
    const act: RunDeps['act'] = (action, { until }) => { waited.push(until); return window.act(action); };
    await runSteps('Export', [step], window.state(), { ...deps(window, ask), known, act });
    expect(waited).toEqual([[sheet]]);
  });

  it('skips a remembered step when what it showed is already there and its element is the chosen one', async () => {
    const window = app([button(1, 'Export', { role: 'row', states: ['selected'] }), button(2, 'Sheet')]);
    const { ask, requests } = jev(() => undefined);
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, ask), known });
    expect(window.acted).toEqual([]);
    expect(requests).toEqual([]);
    expect(report.outcomes[0]).toMatchObject({ status: 'skipped', recalled: true });
  });

  // "New tab" on a start page: the window already looks like the result, and the step still has to be done.
  it('does not take a step for done by the look of the window when its element is not a chosen one', async () => {
    const window = app([button(1, 'Export'), button(2, 'Sheet')], (action, elements) => { if (action.action === 'click') elements.push(button(3, 'Second sheet')); });
    const { ask, requests } = jev((_state, id) => (id === 'expected' ? yes(0.9) : undefined));
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, ask), known });
    expect(window.acted).toHaveLength(1);
    expect(requests.map((request) => request.ids)).toEqual([['already'], ['expected']]);
    expect(report.outcomes[0]?.status).toBe('verified');
  });

  it('asks Jev when the window shows something else this time', async () => {
    const window = app([button(1, 'Export')], (action, elements) => { if (action.action === 'click') elements.push(button(2, 'Error')); });
    const { ask, requests } = jev((_state, id) => (id === 'expected' ? yes(0.9) : undefined));
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, ask), known });
    expect(requests.map((request) => request.ids)).toEqual([['expected']]);
    expect(report.outcomes[0]?.status).toBe('verified');
  });
});

describe('what a step shows differently every time', () => {
  // A calculator key: what appears is the number on the display, never the same twice.
  const sheet = 'button\u001fSheet';
  const step = { do: 'click' as const, target: 'Export', expect: 'the sheet shows' };
  const changing = () => app([button(1, 'Export')], (action, elements) => { if (action.action === 'click') elements.push(button(2, 'Error')); });
  const judged = () => jev((_state, id) => (id === 'expected' ? yes(0.9) : undefined));

  it('is forgotten as its sign: the lesson then says the step leaves none', async () => {
    const window = changing();
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, judged().ask), known });
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', used: { key: 'w/1', effect: [] } });
  });

  it('keeps the part of the sign that did show again', async () => {
    const window = app([button(1, 'Export')], (action, elements) => { if (action.action === 'click') elements.push(button(2, 'Sheet'), button(3, 'Error')); });
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet, 'button\u001f42'] });
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, judged().ask), known });
    expect(report.outcomes[0]?.used?.effect).toEqual([sheet]);
  });

  it('is not waited for once the lesson says so, and stays that way', async () => {
    const window = changing();
    const { ask, requests } = judged();
    const known: RunDeps['known'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [] });
    const waited: Array<readonly string[] | undefined> = [];
    const act: RunDeps['act'] = (action, { until }) => { waited.push(until); return window.act(action); };
    const report = await runSteps('Export', [step], window.state(), { ...deps(window, ask), known, act });
    expect(waited).toEqual([undefined]);
    expect(requests.map((request) => request.ids)).toEqual([['already'], ['expected']]);
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', used: { effect: [] } });
  });
});

describe('what typing showed', () => {
  it('is not kept as a step\'s effect: the text differs every time', async () => {
    const window = app([button(1, 'Search', { role: 'text field', value: '' })], (action, elements) => {
      if (action.action === 'type_text') elements.push(button(2, action.text, { role: 'text' }));
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Find', [{ do: 'type', target: 'Search', text: 'Kopernik', expect: 'the field holds Kopernik' }], window.state(), deps(window, ask));
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', used: { key: 'w/1', way: 0 } });
    expect(report.outcomes[0]?.used?.effect).toBeUndefined();
  });
});

describe('a step that says nothing of its result', () => {
  const window = () => app([button(1, 'Search', { role: 'text field', value: '' })], (action, elements) => {
    if (action.action === 'type_text') (elements[0] as AppElement).value = action.text;
    if (action.action === 'press_key') elements.push(button(2, 'Results', { role: 'text' }));
  });
  const steps: RunStep[] = [{ do: 'type', target: 'Search', text: 'Kopernik' }, { do: 'key', key: 'Return', expect: 'results show' }];

  it('is learned once a later step of the run was seen to work', async () => {
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const opened = window();
    const report = await runSteps('Find', steps, opened.state(), deps(opened, ask));
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'verified']);
    expect(report.outcomes[0]?.used).toMatchObject({ key: 'w/1', way: 0 });
  });

  it('is not learned when nothing after it was seen to work', async () => {
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const opened = window();
    const report = await runSteps('Find', [steps[0] as RunStep, { do: 'key', key: 'Return' }], opened.state(), deps(opened, ask));
    expect(report.outcomes[0]?.used).toBeUndefined();
  });
});

describe('a target worded differently than the lesson', () => {
  const sheet = 'button\u001fSheet';
  const opens = () => app([button(1, 'Export'), button(2, 'Share')], (action, elements) => { if (action.action === 'click' && action.element_index === 1) elements.push(button(3, 'Sheet')); });
  const steps: RunStep[] = [{ do: 'click', target: 'the Export control up top', expect: 'the sheet shows' }];
  const guessed: RunDeps['guess'] = (_step, tree) => ({ element: tree.elements[1] as AppElement, way: 0, effect: [sheet] });

  it('asks Jev once whether the guessed lessons fit, then runs from memory', async () => {
    const window = opens();
    const { ask, requests } = jev((_state, id) => (id === 'same_0' ? yes(0.95) : undefined));
    const report = await runSteps('Export', steps, window.state(), { ...deps(window, ask), guess: guessed });
    expect(requests.map((request) => request.ids)).toEqual([['same_0']]);
    expect(window.acted).toEqual([{ action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 }]);
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', recalled: true, used: { key: 'w/1' } });
  });

  it('finds the element the usual way when Jev says the guess is another element', async () => {
    const window = opens();
    const { ask, requests } = jev((_state, id) => (id === 'same_0' ? yes(0.1) : id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Export', steps, window.state(), { ...deps(window, ask), guess: guessed });
    expect(requests.map((request) => request.ids)).toEqual([['same_0'], ['target', 'already'], ['expected']]);
    expect(report.outcomes[0]?.recalled).toBeUndefined();
  });
});

describe('a key with an expected result', () => {
  const results = 'text\u001fResults';
  const opens = () => app([button(1, 'Search')], (action, elements) => { if (action.action === 'press_key') elements.push(button(2, 'Results', { role: 'text' })); });
  const step: RunStep = { do: 'key', key: 'Return', expect: 'results show' };

  it('reports what it made appear, so it can be remembered', async () => {
    const window = opens();
    const { ask } = jev((_state, id) => (id === 'expected' ? yes(0.9) : undefined));
    const report = await runSteps('Find', [step], window.state(), deps(window, ask));
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', used: { way: 0, effect: [results] } });
  });

  it('is checked without Jev when the same shows again', async () => {
    const window = opens();
    const { ask, requests } = jev(() => undefined);
    const report = await runSteps('Find', [step], window.state(), { ...deps(window, ask), known: () => ({ way: 0, effect: [results] }) });
    expect(requests).toEqual([]);
    expect(window.acted).toHaveLength(1);
    expect(report.outcomes[0]).toMatchObject({ status: 'verified', recalled: true });
  });
});

describe('describeRun', () => {
  it('says what was done to which element and how long it took', async () => {
    const window = app([button(1, 'Export')], (_action, elements) => { elements.push(button(2, 'Dialog')); });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const steps: RunStep[] = [{ do: 'click', target: 'Export', expect: 'a dialog is open' }, { do: 'key', key: 'Return' }];
    const text = describeRun(await runSteps('Export', steps, window.state(), deps(window, ask)), steps);
    expect(text).toMatch(/^computer_run: 2 of 2 steps done in \d+(\.\d)? s/);
    expect(text).toContain('1. verified — click "Export" → [1] button "Export"');
    expect(text).toContain('2. done — key Return');
  });
});

describe('runShortfall — what a run tells the loop it did not get done', () => {
  it('names the step that failed and why, and is nothing for a run that did every step', async () => {
    const stuck = app([button(1, 'Export')]);
    const { ask: none } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const steps: RunStep[] = [{ do: 'click', target: 'Export' }, { do: 'key', key: 'Return' }];
    const failed = await runSteps('Export', steps, stuck.state(), deps(stuck, none));

    expect(failed.outcomes.at(-1)).toMatchObject({ status: 'failed', why: 'nothing changed' });
    expect(runShortfall(failed, steps)).toEqual({ what: 'step 1 of 2, click "Export": nothing changed', unverified: true });

    const open = app([button(1, 'Export')], (_action, elements) => { elements.push(button(2, 'Dialog')); });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : id === 'expected' ? yes(0.9) : undefined));
    const whole: RunStep[] = [{ do: 'click', target: 'Export', expect: 'a dialog is open' }];

    expect(runShortfall(await runSteps('Export', whole, open.state(), deps(open, ask)), whole)).toBeUndefined();
  });
});

