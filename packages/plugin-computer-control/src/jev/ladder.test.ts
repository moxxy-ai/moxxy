import { describe, expect, it } from 'vitest';
import type { AppElement } from '@moxxy/jev';
import { judge, rungs } from './ladder.js';

const field: AppElement = { key: 'w/name', index: 7, depth: 1, role: 'text field', title: 'Name', frame: { x: 100, y: 40, width: 200, height: 20 } };
const bare: AppElement = { key: 'w/bare', index: 8, depth: 1, role: 'button' };

describe('rungs', () => {
  it('clicks the element, then the point in its middle', () => {
    expect(rungs({ do: 'click', target: 'Name' }, field, 'super+a')).toEqual([
      [{ action: 'click', element_index: 7, mouse_button: 'left', click_count: 1 }],
      [{ action: 'click', x: 200, y: 50, mouse_button: 'left', click_count: 1 }],
    ]);
    expect(rungs({ do: 'click', target: 'x' }, bare, 'super+a')).toHaveLength(1);
  });

  it('sets a value directly, then by clicking the field, selecting what it holds and typing', () => {
    expect(rungs({ do: 'set_value', target: 'Name', text: 'clip' }, field, 'ctrl+a')).toEqual([
      [{ action: 'set_value', element_index: 7, value: 'clip' }],
      [
        { action: 'click', element_index: 7, mouse_button: 'left', click_count: 1 },
        { action: 'press_key', key: 'ctrl+a', repeat: 1 },
        { action: 'type_text', text: 'clip' },
      ],
    ]);
  });

  it('types into a described element, then into whatever a click on it focuses', () => {
    expect(rungs({ do: 'type', target: 'Name', text: 'hi' }, field, 'super+a')).toEqual([
      [{ action: 'type_text', element_index: 7, text: 'hi' }],
      [{ action: 'click', element_index: 7, mouse_button: 'left', click_count: 1 }, { action: 'type_text', text: 'hi' }],
    ]);
  });

  it('has one way to type into the focus, press a key or scroll', () => {
    expect(rungs({ do: 'type', text: 'hi' }, undefined, 'super+a')).toEqual([[{ action: 'type_text', text: 'hi' }]]);
    expect(rungs({ do: 'key', key: 'Return' }, undefined, 'super+a')).toEqual([[{ action: 'press_key', key: 'Return', repeat: 1 }]]);
    expect(rungs({ do: 'scroll', target: 'list', direction: 'down' }, field, 'super+a')).toEqual([[{ action: 'scroll', element_index: 7, direction: 'down', pages: 1 }]]);
  });
});

describe('judge', () => {
  const delivered = { outcome: 'delivered' } as const;

  it('goes on after an action that was delivered and changed the window', () => {
    expect(judge({ step: { do: 'click', target: 'Save' }, result: delivered, changed: true })).toEqual({ verdict: 'done', verified: false });
  });

  it('trusts Jev on what the step was expected to show', () => {
    const step = { do: 'click', target: 'Save', expect: 'a save dialog is open' } as const;
    expect(judge({ step, result: delivered, changed: true, expected: 0.9 })).toEqual({ verdict: 'done', verified: true });
    expect(judge({ step, result: delivered, changed: true, expected: 0.1 })).toMatchObject({ verdict: 'retry' });
    // Jev undecided: a changed window is taken as progress, an unchanged one is not.
    expect(judge({ step, result: delivered, changed: true, expected: 0.45 })).toEqual({ verdict: 'done', verified: false });
    expect(judge({ step, result: delivered, changed: false, expected: 0.45 })).toMatchObject({ verdict: 'retry' });
  });

  it('takes typing for done once its text shows in the field: typing again would append it once more', () => {
    const step = { do: 'type', target: 'the address field', text: 'olx.pl', expect: 'OLX opens' } as const;
    expect(judge({ step, result: delivered, changed: true, expected: 0.1, typed: true })).toEqual({ verdict: 'done', verified: false });
    expect(judge({ step, result: delivered, changed: false, typed: true })).toEqual({ verdict: 'done', verified: false });
    expect(judge({ step, result: delivered, changed: true, expected: 0.9, typed: true })).toEqual({ verdict: 'done', verified: true });
    expect(judge({ step, result: delivered, changed: true, expected: 0.1, typed: false })).toMatchObject({ verdict: 'retry' });
  });

  it('takes a key for done when another window came to the front: Jev cannot tell a new window from an old one', () => {
    const step = { do: 'key', key: 'super+n', expect: 'a new window is open' } as const;
    expect(judge({ step, result: delivered, changed: true, expected: 0.2, moved: true })).toEqual({ verdict: 'done', verified: false });
    expect(judge({ step, result: delivered, changed: true, expected: 0.2, moved: false })).toMatchObject({ verdict: 'retry' });
    expect(judge({ step: { do: 'click', target: 'Tab', expect: 'a new window is open' }, result: delivered, changed: true, expected: 0.2, moved: true })).toMatchObject({ verdict: 'retry' });
  });

  it('stops when only the screenshot changed after a click at a point: Jev cannot see what the click did, and another click may undo it', () => {
    const step = { do: 'click', target: 'Sort', expect: 'the sort options show' } as const;
    expect(judge({ step, result: delivered, changed: true, expected: 0.1, unseen: true })).toMatchObject({ verdict: 'stop', why: expect.stringMatching(/screenshot/) });
    expect(judge({ step, result: delivered, changed: true, expected: 0.9, unseen: true })).toEqual({ verdict: 'done', verified: true });
  });

  // Canva creates the design before its editor loads: a second click would start a second one.
  it('stops after a link was followed whose page has not come yet, instead of clicking again', () => {
    const step = { do: 'click', target: 'YouTube thumbnail', expect: 'the editor opens' } as const;
    const loading = { outcome: 'delivered', code: 'page_loading' } as const;
    expect(judge({ step, result: loading, changed: false, expected: 0.1 })).toMatchObject({ verdict: 'stop', why: expect.stringMatching(/loading/) });
    expect(judge({ step: { do: 'click', target: 'YouTube thumbnail' }, result: loading, changed: false })).toMatchObject({ verdict: 'stop' });
    expect(judge({ step, result: loading, changed: true, expected: 0.9 })).toEqual({ verdict: 'done', verified: true });
  });

  it('tries another way after a click or a value that changed nothing', () => {
    expect(judge({ step: { do: 'click', target: 'Save' }, result: delivered, changed: false })).toMatchObject({ verdict: 'retry' });
    expect(judge({ step: { do: 'set_value', target: 'Name', text: 'a' }, result: delivered, changed: false })).toMatchObject({ verdict: 'retry' });
  });

  it('accepts a key or a scroll that changed nothing visible', () => {
    expect(judge({ step: { do: 'key', key: 'Escape' }, result: delivered, changed: false })).toEqual({ verdict: 'done', verified: false });
    expect(judge({ step: { do: 'scroll', target: 'list', direction: 'down' }, result: delivered, changed: false })).toEqual({ verdict: 'done', verified: false });
  });

  it('tries another way when the action did not go through', () => {
    expect(judge({ step: { do: 'click', target: 'Save' }, result: { outcome: 'unsupported', code: 'unsupported_action' }, changed: false })).toMatchObject({ verdict: 'retry' });
    expect(judge({ step: { do: 'click', target: 'Save' }, result: { outcome: 'blocked', code: 'hit_test_mismatch' }, changed: false })).toMatchObject({ verdict: 'retry' });
  });

  it('stops at once for what only the user or the main model can resolve', () => {
    for (const code of ['user_stopped', 'user_intervened', 'screen_locked', 'permissions_not_granted', 'tier_insufficient', 'app_not_allowed', 'protected_path'] as const) {
      expect(judge({ step: { do: 'click', target: 'Save' }, result: { outcome: 'blocked', code }, changed: false })).toMatchObject({ verdict: 'stop' });
    }
  });

  it('takes another way when the element would not take the input: focus left the field, or something covers it', () => {
    const step = { do: 'type' as const, target: 'the search field', text: 'x' };
    expect(judge({ step, result: { outcome: 'blocked', code: 'target_blocked' }, changed: false })).toEqual({ verdict: 'retry', why: 'blocked (target_blocked)' });
  });
});
