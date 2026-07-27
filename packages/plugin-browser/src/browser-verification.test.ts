import { describe, expect, it } from 'vitest';
import {
  diffBrowserStates,
  executeVerifiedBrowserAction,
  verifyBrowserExpectation,
} from './browser-verification.js';

const before = {
  revision: 'rev-1',
  url: 'https://example.com/editor',
  visibleText: 'Draft',
  nodes: [{ ref: 'b1', role: 'button', name: 'Save' }],
};

describe('browser action verification', () => {
  it('reports changed state and verifies expected text', () => {
    const after = { ...before, revision: 'rev-2', visibleText: 'Draft Saved' };
    expect(diffBrowserStates(before, after)).toMatchObject({ changed: true });
    expect(verifyBrowserExpectation({ type: 'text', text: 'Saved' }, after)).toEqual({
      ok: true,
      evidence: 'visible text contains "Saved"',
    });
  });

  it('does not verify text that was already present before the action', () => {
    const after = { ...before, revision: 'rev-2', visibleText: 'Draft Saved elsewhere' };
    const previous = { ...before, visibleText: 'Draft Saved' };

    expect(verifyBrowserExpectation(
      { type: 'text', text: 'Saved' },
      after,
      previous,
    )).toEqual({
      ok: false,
      evidence: 'visible text already contained "Saved" before the action',
    });
  });

  it('does not claim success when state did not change', () => {
    expect(diffBrowserStates(before, before)).toMatchObject({ changed: false });
  });

  it('verifies a visual-region postcondition only from a fresh visual revision', () => {
    const expectation = { type: 'visual_region' as const, x: 0, y: 0, width: 500, height: 500 };
    expect(verifyBrowserExpectation(
      expectation,
      { ...before, visualRevision: 'visual-2' },
      { ...before, visualRevision: 'visual-1' },
    )).toMatchObject({ ok: true });
    expect(verifyBrowserExpectation(
      expectation,
      { ...before, visualRevision: 'visual-1' },
      { ...before, visualRevision: 'visual-1' },
    )).toMatchObject({ ok: false });
  });

  it('uses safe inspection evidence for selector-based control expectations', async () => {
    const calls: unknown[] = [];
    const results = [
      before,
      { ok: true },
      { ...before, revision: 'rev-2', visibleText: 'Draft Saved' },
      { ...before, revision: 'rev-2', visibleText: 'Draft Saved' },
      { inspection: { visible: true, value: 'Light', checked: false, disabled: false } },
    ];

    const result = await executeVerifiedBrowserAction(
      {
        kind: 'type',
        target: { type: 'selector', selector: '#theme' },
        value: 'Light',
        expect: {
          type: 'control',
          target: { type: 'selector', selector: '#theme' },
          property: 'value',
          equals: 'Light',
        },
      },
      async (action) => {
        calls.push(action);
        return results.shift();
      },
      { stabilizationMs: 0 },
    );

    expect(calls.at(-1)).toMatchObject({
      kind: 'inspect',
      target: { type: 'selector', selector: '#theme' },
    });
    expect(result).toMatchObject({
      status: 'verified',
      verification: { ok: true },
    });
  });
});
