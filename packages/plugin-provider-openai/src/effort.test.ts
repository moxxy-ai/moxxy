import { describe, expect, it } from 'vitest';
import { openaiEffort } from './effort.js';

describe('openaiEffort', () => {
  it('passes the levels the OpenAI API knows', () => {
    expect(openaiEffort('low')).toBe('low');
    expect(openaiEffort('xhigh')).toBe('xhigh');
    expect(openaiEffort('max')).toBe('max');
  });

  it('sends ultra, which only the Codex agent has, as max', () => {
    expect(openaiEffort('ultra')).toBe('max');
  });

  it('sends no effort when none is set', () => {
    expect(openaiEffort(undefined)).toBeUndefined();
  });
});
