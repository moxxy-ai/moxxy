import { describe, expect, it } from 'vitest';
import { ComputerUseError, actionResultSchema, describeResult, errorCodes, hintFor } from './outcome.js';

describe('actionResultSchema', () => {
  it('accepts the four technical outcomes', () => {
    for (const outcome of ['delivered', 'ineffective', 'unsupported', 'blocked'] as const) {
      expect(actionResultSchema.parse({ outcome })).toEqual({ outcome });
    }
    expect(actionResultSchema.parse({ outcome: 'blocked', code: 'not_frontmost', method: 'input' }))
      .toEqual({ outcome: 'blocked', code: 'not_frontmost', method: 'input' });
  });

  it('names how a delivered action was sent', () => {
    for (const method of ['ax', 'input', 'background'] as const) {
      expect(actionResultSchema.parse({ outcome: 'delivered', method })).toEqual({ outcome: 'delivered', method });
    }
  });

  it('rejects an outcome or code the contract does not know', () => {
    expect(() => actionResultSchema.parse({ outcome: 'verified' })).toThrow();
    expect(() => actionResultSchema.parse({ outcome: 'blocked', code: 'mystery' })).toThrow();
  });
});

describe('hintFor', () => {
  it('has a next step for every code', () => {
    for (const code of errorCodes) expect(hintFor(code).length).toBeGreaterThan(10);
  });

  it('sends a stale index back to a fresh observation', () => {
    expect(hintFor('stale_state')).toMatch(/computer_get_app_state/);
  });

  it('points an ambiguous name at computer_list_apps', () => {
    expect(hintFor('ambiguous_app')).toMatch(/computer_list_apps/);
  });
});

describe('describeResult', () => {
  it('says a delivered action is not yet verified', () => {
    expect(describeResult({ outcome: 'delivered' })).toMatch(/delivered.*verify/i);
  });

  it('says when a followed link has not brought its page yet, so the model looks before clicking again', () => {
    const text = describeResult({ outcome: 'delivered', code: 'page_loading', method: 'ax' });
    expect(text).toMatch(/delivered/i);
    expect(text).toContain(hintFor('page_loading'));
    expect(hintFor('page_loading')).toMatch(/still loading[\s\S]*computer_get_app_state[\s\S]*twice/);
  });

  it('names the code and its hint when the action did not go through', () => {
    const text = describeResult({ outcome: 'blocked', code: 'tier_insufficient' });
    expect(text).toContain('blocked');
    expect(text).toContain('tier_insufficient');
    expect(text).toContain(hintFor('tier_insufficient'));
  });

  it('prefers the helper hint when it has one', () => {
    expect(describeResult({ outcome: 'unsupported', code: 'canvas', hint: 'Use computer_drag.' }))
      .toContain('Use computer_drag.');
  });
});

describe('ComputerUseError', () => {
  it('carries a known code and its hint', () => {
    const error = new ComputerUseError('stale_state', 'Element 4 is gone');
    expect(error.code).toBe('stale_state');
    expect(error.message).toContain('Element 4 is gone');
    expect(error.message).toContain(hintFor('stale_state'));
  });
});
