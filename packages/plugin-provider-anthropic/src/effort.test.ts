import { describe, expect, it } from 'vitest';
import { anthropicEffort } from './effort.js';

describe('anthropicEffort', () => {
  it('passes the levels the Messages API knows', () => {
    expect(anthropicEffort('low')).toBe('low');
    expect(anthropicEffort('high')).toBe('high');
  });

  it('sends xhigh as high', () => {
    expect(anthropicEffort('xhigh')).toBe('high');
  });
});
