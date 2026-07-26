import { describe, expect, it } from 'vitest';

import { browserSessionActionSchema } from './browser-action.js';

describe('browserSessionActionSchema computer-use contract', () => {
  it('accepts a bounded semantic observation request', () => {
    expect(
      browserSessionActionSchema.parse({
        kind: 'observe',
        mode: 'semantic',
        maxNodes: 120,
        tabId: 'tab-1',
      }),
    ).toEqual({
      kind: 'observe',
      mode: 'semantic',
      maxNodes: 120,
      tabId: 'tab-1',
    });
  });

  it('accepts a revision-bound element reference', () => {
    expect(
      browserSessionActionSchema.parse({
        kind: 'click',
        target: { type: 'ref', ref: 'b17', revision: 'rev-4' },
        tabId: 'tab-1',
      }),
    ).toEqual({
      kind: 'click',
      target: { type: 'ref', ref: 'b17', revision: 'rev-4' },
      tabId: 'tab-1',
    });
  });

  it('accepts viewport-normalized coordinates and rejects desktop coordinates', () => {
    expect(
      browserSessionActionSchema.parse({
        kind: 'click',
        target: { type: 'point', x: 500, y: 250 },
      }),
    ).toMatchObject({ kind: 'click' });

    expect(() =>
      browserSessionActionSchema.parse({
        kind: 'click',
        target: { type: 'point', x: 1800, y: 250 },
      }),
    ).toThrow();
  });

  it('accepts generic keyboard, scroll, hover, and drag actions', () => {
    expect(
      browserSessionActionSchema.parse({
        kind: 'press',
        key: 'Enter',
        modifiers: ['shift'],
      }),
    ).toMatchObject({ kind: 'press' });
    expect(
      browserSessionActionSchema.parse({
        kind: 'scroll',
        deltaY: 480,
      }),
    ).toMatchObject({ kind: 'scroll' });
    expect(
      browserSessionActionSchema.parse({
        kind: 'hover',
        target: { type: 'selector', selector: '[aria-label="Profile"]' },
      }),
    ).toMatchObject({ kind: 'hover' });
    expect(
      browserSessionActionSchema.parse({
        kind: 'drag',
        from: { type: 'ref', ref: 'b4', revision: 'rev-2' },
        to: { type: 'point', x: 800, y: 500 },
      }),
    ).toMatchObject({ kind: 'drag' });
  });

  it('accepts dropdowns, uploads, waits, and history navigation', () => {
    expect(
      browserSessionActionSchema.parse({
        kind: 'select',
        target: { type: 'ref', ref: 'b8', revision: 'rev-2' },
        values: ['Poland'],
      }),
    ).toMatchObject({ kind: 'select', values: ['Poland'] });
    expect(
      browserSessionActionSchema.parse({
        kind: 'upload',
        target: { type: 'selector', selector: 'input[type=file]' },
        paths: ['/tmp/photo.png'],
      }),
    ).toMatchObject({ kind: 'upload' });
    expect(
      browserSessionActionSchema.parse({
        kind: 'wait',
        condition: {
          type: 'target',
          target: { type: 'selector', selector: '[role=dialog]' },
          state: 'visible',
        },
      }),
    ).toMatchObject({ kind: 'wait' });
    expect(browserSessionActionSchema.parse({ kind: 'back' })).toEqual({ kind: 'back' });
    expect(browserSessionActionSchema.parse({ kind: 'forward' })).toEqual({ kind: 'forward' });
    expect(browserSessionActionSchema.parse({ kind: 'reload' })).toEqual({ kind: 'reload' });
  });

  it('rejects ambiguous or missing click targets', () => {
    expect(() => browserSessionActionSchema.parse({ kind: 'click' })).toThrow();
    expect(() =>
      browserSessionActionSchema.parse({
        kind: 'click',
        selector: '#legacy',
        target: { type: 'selector', selector: '#new' },
      }),
    ).toThrow();
  });
});
