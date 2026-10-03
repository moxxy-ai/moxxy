import { describe, expect, it } from 'vitest';
import type { AppTree } from '../contract/tree.js';
import type { ChoiceAnswer } from './client.js';
import { OPTIONS_PER_QUESTION, STATE_CHARS, byName, byText, readTarget, targetQuestions, windowState } from './ground.js';

const tree: AppTree = {
  app: 'Settings', window: 'General',
  elements: [
    { key: 'w', index: 0, depth: 0, role: 'window', title: 'General' },
    { key: 'w/row', index: 1, depth: 1, role: 'row' },
    { key: 'w/row/cell', index: 2, depth: 2, role: 'cell' },
    { key: 'w/row/cell/text', index: 3, depth: 3, role: 'text', title: 'Bluetooth' },
    { key: 'w/row2', index: 4, depth: 1, role: 'row' },
    { key: 'w/row2/text', index: 5, depth: 2, role: 'text', title: 'Network' },
    { key: 'w/search', index: 9, depth: 1, role: 'search field', value: '' },
  ],
};
const choice = (probabilities: Record<string, number>): ChoiceAnswer => {
  const [top] = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return { type: 'choice', choice: top?.[0] ?? 'none', probabilities, confidence: 0.5 };
};
const big = (count: number): AppTree => ({
  app: 'Big', elements: Array.from({ length: count }, (_, index) => ({ key: `k${index}`, index, depth: index === 0 ? 0 : 1, role: 'button', title: `B${index}` })),
});

describe('windowState', () => {
  it('shows Jev the window the way the model sees it, without the header line', () => {
    const state = windowState(tree);
    expect(state.app).toBe('Settings');
    expect(state.window).toBe('General');
    expect(state.elements.split('\n')[0]).toBe('[0] window "General"');
    expect(state.elements).toContain('      [3] text "Bluetooth"');
  });

  it('shortens what elements say until a long page fits Jev, keeping every element', () => {
    const page: AppTree = { app: 'Browser', elements: Array.from({ length: 400 }, (_, index) => ({ key: `k${index}`, index, depth: 1, role: 'text', title: `Paragraph ${index} ${'word '.repeat(40)}` })) };
    const whole = windowState(page, 1_000_000).elements;
    const fitted = windowState(page).elements;
    expect(whole.length).toBeGreaterThan(STATE_CHARS);
    expect(fitted.length).toBeLessThanOrEqual(STATE_CHARS);
    expect(fitted.split('\n')).toHaveLength(400);
    expect(fitted).toContain('[399] text "Paragraph 399 word');
  });
});

describe('targetQuestions', () => {
  it('offers every element by its index, and none', () => {
    const { target } = targetQuestions(tree);
    expect(target?.type).toBe('choice');
    expect(Object.keys(target?.criteria ?? {})).toEqual(['0', '1', '2', '3', '4', '5', '9', 'none']);
  });

  it('splits a long window into several questions of one request', () => {
    const questions = targetQuestions(big(OPTIONS_PER_QUESTION + 10));
    expect(Object.keys(questions)).toEqual(['target_0', 'target_1']);
    expect(Object.keys(questions.target_1?.criteria ?? {})).toEqual([...Array.from({ length: 10 }, (_, index) => String(OPTIONS_PER_QUESTION + index)), 'none']);
  });

  it('asks nothing about a window with more elements than Jev can weigh', () => {
    expect(targetQuestions(big(1001))).toEqual({});
  });
});

describe('readTarget', () => {
  it('takes the element Jev is sure of', () => {
    const grounding = readTarget(tree, { target: choice({ 9: 0.92, 5: 0.05, none: 0.03 }) });
    expect(grounding).toMatchObject({ kind: 'element', element: { index: 9 }, probability: 0.92, others: [] });
  });

  // A row, its cell and its text are one thing on screen; Jev spreads its answer over them.
  it('counts an element together with what contains it and what it contains', () => {
    const grounding = readTarget(tree, { target: choice({ 3: 0.4, 1: 0.3, 2: 0.25, 5: 0.05 }) });
    expect(grounding).toMatchObject({ kind: 'element', element: { index: 3 } });
    expect(grounding.kind === 'element' && grounding.probability).toBeCloseTo(0.95);
  });

  it('keeps the window out of an element\'s family, or everything would be one thing', () => {
    const grounding = readTarget(tree, { target: choice({ 3: 0.3, 5: 0.3, 0: 0.3, none: 0.1 }) });
    expect(grounding.kind).toBe('none');
  });

  it('offers the next best element as another try', () => {
    const grounding = readTarget(tree, { target: choice({ 3: 0.6, 5: 0.3, 9: 0.05, none: 0.05 }) });
    expect(grounding).toMatchObject({ kind: 'element', element: { index: 3 }, others: [{ index: 5 }] });
  });

  it('finds nothing when Jev says none or is not sure, and names the closest', () => {
    expect(readTarget(tree, { target: choice({ none: 0.8, 5: 0.2 }) })).toMatchObject({ kind: 'none', closest: [{ index: 5 }] });
    expect(readTarget(tree, { target: choice({ 3: 0.3, 5: 0.3, 9: 0.3, none: 0.1 }) })).toMatchObject({ kind: 'none' });
  });

  it('reads the answer across the questions of a long window', () => {
    const long = big(OPTIONS_PER_QUESTION + 10);
    const grounding = readTarget(long, { target_0: choice({ none: 0.9, 4: 0.1 }), target_1: choice({ 255: 0.85, none: 0.15 }) });
    expect(grounding).toMatchObject({ kind: 'element', element: { index: 255 } });
    expect(readTarget(long, { target_0: choice({ none: 0.9, 4: 0.1 }), target_1: choice({ none: 0.8, 255: 0.2 }) }).kind).toBe('none');
  });

  it('finds nothing without an answer', () => {
    expect(readTarget(tree, {})).toEqual({ kind: 'none', closest: [] });
  });
});

describe('byName', () => {
  const page: AppTree = {
    app: 'Safari', window: 'OLX',
    elements: [
      { key: 'w', index: 0, depth: 0, role: 'window', title: 'OLX' },
      { key: 'w/search', index: 1, depth: 1, role: 'combo box', title: 'Znajdź coś dla siebie', value: '' },
      { key: 'w/go', index: 2, depth: 1, role: 'button', title: 'Szukaj' },
      { key: 'w/a', index: 3, depth: 1, role: 'link', title: 'Rower' },
      { key: 'w/b', index: 4, depth: 1, role: 'link', title: 'Rower' },
      { key: 'w/address', index: 5, depth: 1, role: 'text field', description: 'inteligentne pole wyszukiwania', value: 'olx.pl' },
    ],
  };

  it('is the one element whose name is the whole target, kinds of element aside', () => {
    expect(byName(page, { do: 'click', target: 'Szukaj button' })?.index).toBe(2);
    expect(byName(page, { do: 'click', target: 'the "Szukaj" przycisk' })?.index).toBe(2);
    expect(byName(page, { do: 'type', target: 'Znajdź coś dla siebie', text: 'rower' })?.index).toBe(1);
    expect(byName(page, { do: 'set_value', target: 'inteligentne pole wyszukiwania', text: 'olx.pl' })?.index).toBe(5);
  });

  it('is nothing when the name is shared, only part of the target, or the element takes no text', () => {
    expect(byName(page, { do: 'click', target: 'Rower link' })).toBeUndefined();
    expect(byName(page, { do: 'click', target: 'Szukaj button next to the search field' })).toBeUndefined();
    expect(byName(page, { do: 'type', target: 'Szukaj', text: 'x' })).toBeUndefined();
    expect(byName(page, { do: 'key', key: 'Return' })).toBeUndefined();
  });

  it('is the one element named by what the target quotes, whatever else it says', () => {
    const suggested: AppTree = { ...page, elements: [...page.elements,
      { key: 'w/s', index: 6, depth: 1, role: 'text', title: 'Kraków Kraków, Małopolskie' },
      { key: 'w/t', index: 7, depth: 1, role: 'text', title: 'Kraków' },
    ] };
    expect(byName(suggested, { do: 'click', target: 'sugestia „Kraków Kraków, Małopolskie” na samej górze listy' })?.index).toBe(6);
    expect(byName(suggested, { do: 'type', target: 'pole wyszukiwania "Znajdź coś dla siebie"', text: 'rower' })?.index).toBe(1);
    expect(byName(suggested, { do: 'click', target: 'link „Rower” w wynikach' })).toBeUndefined();
    expect(byName(suggested, { do: 'click', target: 'sugestia „Gdańsk” na liście' })).toBeUndefined();
  });

  it('is the outermost of the elements that carry one name inside each other', () => {
    const linked: AppTree = { ...page, elements: [...page.elements,
      { key: 'w/ad', index: 6, depth: 1, role: 'link', title: 'iPhone 13 128GB' },
      { key: 'w/ad/text', index: 7, depth: 2, role: 'text', title: 'iPhone 13 128GB' },
    ] };
    expect(byName(linked, { do: 'click', target: 'iPhone 13 128GB' })?.index).toBe(6);
  });
});

describe('byText', () => {
  // What the screenshot reads where accessibility names a control otherwise (Canva's "Dodaj tytuł" is "Title, Heading").
  const lines = [
    { text: 'Dodaj tytul', x: 60, y: 280, width: 120, height: 24 },
    { text: 'Dodaj podtytuł', x: 60, y: 320, width: 140, height: 20 },
    { text: 'Rower', x: 10, y: 10, width: 40, height: 12 },
    { text: 'Rower', x: 10, y: 40, width: 40, height: 12 },
  ];

  it('is the one line of the screenshot that reads as the target, with or without the marks on its letters', () => {
    expect(byText(lines, { do: 'click', target: 'przycisk „Dodaj tytuł” w panelu Tekst' })).toBe(lines[0]);
    expect(byText(lines, { do: 'click', target: 'Dodaj tytuł button' })).toBe(lines[0]);
    expect(byText(lines, { do: 'click', target: 'Dodaj podtytul' })).toBe(lines[1]);
  });

  it('is nothing for a text shown twice, a part of a line, or a step that is not a click', () => {
    expect(byText(lines, { do: 'click', target: 'Rower' })).toBeUndefined();
    expect(byText(lines, { do: 'click', target: 'Dodaj' })).toBeUndefined();
    expect(byText(lines, { do: 'set_value', target: 'Dodaj tytuł', text: 'x' })).toBeUndefined();
  });
});
