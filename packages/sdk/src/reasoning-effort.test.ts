import { describe, expect, it } from 'vitest';
import {
  REASONING_EFFORTS,
  fitReasoningEffort,
  fitReasoningRequest,
  isReasoningEffort,
  reasoningEffortsFrom,
  reasoningEffortsOf,
} from './reasoning-effort.js';

describe('the reasoning effort scale', () => {
  it('runs from low to ultra', () => {
    expect(REASONING_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  });

  it('knows its own levels and nothing else', () => {
    expect(isReasoningEffort('max')).toBe(true);
    expect(isReasoningEffort('ultra')).toBe(true);
    expect(isReasoningEffort('turbo')).toBe(false);
    expect(isReasoningEffort('none')).toBe(false);
    expect(isReasoningEffort(undefined)).toBe(false);
  });
});

describe('reasoningEffortsOf', () => {
  it('gives a model that names no levels the four every reasoning provider takes', () => {
    expect(reasoningEffortsOf({})).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(reasoningEffortsOf(undefined)).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(reasoningEffortsOf({ reasoningEfforts: [] })).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('gives a model the levels it names', () => {
    expect(reasoningEffortsOf({ reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] })).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });
});

describe('reasoningEffortsFrom', () => {
  it('keeps the levels Moxxy knows, once each, lowest first', () => {
    expect(reasoningEffortsFrom(['ultra', 'none', 'low', 'max', 'minimal', 'low', 42, 'xhigh'])).toEqual([
      'low',
      'xhigh',
      'max',
      'ultra',
    ]);
  });
});

describe('fitReasoningEffort', () => {
  const luna = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

  it('keeps a level the model offers', () => {
    expect(fitReasoningEffort('max', luna)).toBe('max');
  });

  it('lowers a level the model lacks to the highest one below it', () => {
    expect(fitReasoningEffort('ultra', luna)).toBe('max');
    expect(fitReasoningEffort('max', ['low', 'medium', 'high', 'xhigh'])).toBe('xhigh');
    expect(fitReasoningEffort('xhigh', ['low', 'high'])).toBe('high');
  });

  it('raises a level below everything the model offers to its lowest one', () => {
    expect(fitReasoningEffort('low', ['high', 'max'])).toBe('high');
  });

  it('keeps the level when the model offers none at all', () => {
    expect(fitReasoningEffort('ultra', [])).toBe('ultra');
  });
});

describe('fitReasoningRequest', () => {
  const luna = { supportsReasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] as const };

  it('asks a model for the level it runs the wanted one at', () => {
    expect(fitReasoningRequest({ effort: 'ultra' }, luna)).toEqual({ effort: 'max' });
    expect(fitReasoningRequest({ effort: 'max' }, { supportsReasoning: true })).toEqual({ effort: 'xhigh' });
  });

  it('passes reasoning without a level, or with one the model takes, as it is', () => {
    const on = { effort: 'high' } as const;
    expect(fitReasoningRequest(on, luna)).toBe(on);
    expect(fitReasoningRequest(true, luna)).toBe(true);
    expect(fitReasoningRequest(undefined, luna)).toBeUndefined();
  });

  it('leaves the level to the agent for a model Moxxy has no description of', () => {
    expect(fitReasoningRequest({ effort: 'ultra' }, undefined)).toEqual({ effort: 'ultra' });
  });
});
