import { assertDefined } from '@moxxy/sdk';
import type { ActionResult, ErrorCode } from '../contract/outcome.js';
import type { ComputerAction, RunStep } from '../contract/tools.js';
import type { AppElement } from '../contract/tree.js';

/** How sure Jev must be that the expected result shows, and below what it certainly does not. */
const HOLDS = 0.6;
const FAILS = 0.3;

/** What only the user or the main model can resolve; trying another way would not help. */
const FINAL: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'user_stopped', 'user_intervened', 'screen_locked', 'permissions_not_granted', 'permissions_pending', 'tier_insufficient',
  'app_not_allowed', 'protected_path', 'system_key_combo', 'clipboard_not_granted', 'own_window',
]);

const click = (target: { element_index: number } | { x: number; y: number }): ComputerAction => ({ action: 'click', ...target, mouse_button: 'left', click_count: 1 });

/** The ways to carry out a step on its element, best first. Each way is a short run of actions. */
export function rungs(step: RunStep, element: AppElement | undefined, selectAll: string): ComputerAction[][] {
  const { key, text, direction } = step;
  if (step.do === 'key') {
    assertDefined(key, 'a key step has a key');
    return [[{ action: 'press_key', key, repeat: 1 }]];
  }
  if (step.do === 'type' && !element) {
    assertDefined(text, 'a type step has text');
    return [[{ action: 'type_text', text }]];
  }
  assertDefined(element, `a ${step.do} step has an element`);
  const { index, frame } = element;
  const onElement = click({ element_index: index });
  if (step.do === 'click') {
    return [[onElement], ...(frame ? [[click({ x: Math.round(frame.x + frame.width / 2), y: Math.round(frame.y + frame.height / 2) })]] : [])];
  }
  if (step.do === 'scroll') {
    assertDefined(direction, 'a scroll step has a direction');
    return [[{ action: 'scroll', element_index: index, direction, pages: 1 }]];
  }
  assertDefined(text, `a ${step.do} step has text`);
  if (step.do === 'type') return [[{ action: 'type_text', element_index: index, text }], [onElement, { action: 'type_text', text }]];
  const typed: ComputerAction = text === '' ? { action: 'press_key', key: 'BackSpace', repeat: 1 } : { action: 'type_text', text };
  return [[{ action: 'set_value', element_index: index, value: text }], [onElement, { action: 'press_key', key: selectAll, repeat: 1 }, typed]];
}

export type Verdict =
  | { readonly verdict: 'done'; readonly verified: boolean }
  | { readonly verdict: 'retry'; readonly why: string }
  | { readonly verdict: 'stop'; readonly why: string };

export interface Attempt {
  readonly step: RunStep;
  readonly result: ActionResult;
  /** Whether the window looks different than before the attempt. */
  readonly changed: boolean;
  /** Jev's probability that `step.expect` holds now; absent when the step expects nothing. */
  readonly expected?: number;
  /** A click at a point changed the screenshot and no element: what it did is outside what Jev is shown. */
  readonly unseen?: boolean;
}

const UNSEEN = 'the click changed the screenshot but no element, so its result cannot be checked here and it was not clicked again (another click may undo it). Read the screenshot: when it shows the result, continue with the single tools by x and y';

/** What one attempt at a step means for the run. */
export function judge({ step, result, changed, expected, unseen }: Attempt): Verdict {
  if (result.outcome !== 'delivered') {
    const why = `${result.outcome}${result.code ? ` (${result.code})` : ''}`;
    return result.code && FINAL.has(result.code) ? { verdict: 'stop', why } : { verdict: 'retry', why };
  }
  if (expected !== undefined) {
    if (expected >= HOLDS) return { verdict: 'done', verified: true };
    if (unseen) return { verdict: 'stop', why: UNSEEN };
    if (expected <= FAILS || !changed) return { verdict: 'retry', why: 'the expected result does not show' };
    return { verdict: 'done', verified: false };
  }
  // A key or a scroll can be right and still change nothing visible; a click or a value cannot.
  if (!changed && step.do !== 'key' && step.do !== 'scroll') return { verdict: 'retry', why: 'nothing changed' };
  return { verdict: 'done', verified: false };
}
