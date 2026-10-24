import { describe, expect, it } from 'vitest';
import { agentPlanTitle } from './plan-loop.js';

describe("an agent plan's card title", () => {
  it.each([
    ['# Fix `add` and cover it\n\nBody', 'Fix `add` and cover it'],
    ['## Plan: Currency converter\n\n### Summary', 'Currency converter'],
    ['Intro line\n\n### Plan — Photo app\n', 'Photo app'],
    ['No heading at all.', 'Plan'],
    ['## Plan\n\n### Summary', 'Plan'],
  ])('%j → %j', (plan, title) => {
    expect(agentPlanTitle(plan)).toBe(title);
  });
});
