import { describe, expect, it } from 'vitest';
import type { AppState } from '../backend/rpc.js';
import { ComputerUseError, type ActionResult } from '../contract/outcome.js';
import type { ComputerAction, RunStep } from '../contract/tools.js';
import type { AppElement } from '../contract/tree.js';
import { JevError, type AskJev, type JevAnswers, type JevQuestion } from './client.js';
import { describeRun, runSteps, type RunDeps } from './run.js';

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
  it('finds each element on the live window and acts on it, one decision per step', async () => {
    const window = app([button(1, 'Export'), button(2, 'Cancel')], (action, elements) => {
      if (action.action === 'click' && action.element_index === 1) elements.push(button(3, 'Save'));
      if (action.action === 'click' && action.element_index === 3) elements.push(button(4, 'Saved'));
    });
    const { ask, requests } = jev((state, id) => {
      if (id !== 'target') return undefined;
      return state.step?.target === 'the Export button' ? pick(1) : state.elements.includes('"Save"') ? pick(3) : pick('none');
    });
    const report = await runSteps('Export the clip', [{ do: 'click', target: 'the Export button' }, { do: 'click', target: 'the Save button' }], window.state(), deps(window, ask));
    expect(window.acted).toEqual([
      { action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 },
      { action: 'click', element_index: 3, mouse_button: 'left', click_count: 1 },
    ]);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    expect(report.outcomes[0]?.element).toBe('[1] button "Export"');
    // The second step's element is asked for in the request that follows the first action.
    expect(requests.map((request) => request.ids)).toEqual([['target'], ['target']]);
    expect(requests[0]?.state).toMatchObject({ goal: 'Export the clip', app: 'Editor', step: { do: 'click', target: 'the Export button' } });
    expect(report.asks).toBe(2);
    expect(report.state.tree.elements).toHaveLength(5);
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
    const report = await runSteps('Open export', [{ do: 'click', target: 'Export', expect: 'a dialog is open' }], window.state(), deps(window, ask));
    expect(report.outcomes).toMatchObject([{ status: 'verified', attempts: 1 }]);
    expect(requests.map((request) => request.ids)).toEqual([['target', 'already'], ['expected']]);
    expect(requests[1]?.state).toMatchObject({ performed: { do: 'click', target: 'Export' } });
    expect(String(requests[1]?.state.changes)).toContain('+ [2] button "Dialog"');
  });

  it('tries the next way when the first one changes nothing', async () => {
    const window = app([button(1, 'Export')], (action, elements) => {
      if (action.action === 'click' && action.x !== undefined) elements.push(button(2, 'Dialog'));
    });
    const { ask } = jev((_state, id) => (id === 'target' ? pick(1) : undefined));
    const report = await runSteps('Open export', [{ do: 'click', target: 'Export' }], window.state(), deps(window, ask));
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

  it('hands back to the main model when Jev cannot be asked', async () => {
    const window = app([button(1, 'Export')]);
    const ask: AskJev = async () => { throw new JevError(401, 'Jev returned HTTP 401'); };
    const report = await runSteps('Export', [{ do: 'click', target: 'Export' }], window.state(), deps(window, ask));
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
    const report = await runSteps('Open Privacy', [{ do: 'click', target: 'Privacy', expect: 'the Privacy pane shows' }], window.state(), { ...deps(window, ask), observe: late });
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
    const report = await runSteps('Export', [{ do: 'click', target: 'Export', expect: 'the sheet shows' }], window.state(), { ...deps(window, ask), known });
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
    const act: RunDeps['act'] = (action, until) => { waited.push(until); return window.act(action); };
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
