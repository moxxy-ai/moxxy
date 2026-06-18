import { describe, expect, it } from 'vitest';
import type { Action } from './reducer.js';
import { parseInputChunk, type ParseCtx } from './parse-input.js';

function makeCtx(overrides: Partial<ParseCtx> = {}): { ctx: ParseCtx; actions: Action[] } {
  const actions: Action[] = [];
  const ctx: ParseCtx = {
    inPaste: false,
    pasteAccum: { text: '' },
    dispatch: (action) => actions.push(action),
    onSubmit: () => undefined,
    onCancel: () => undefined,
    onSlashUp: () => undefined,
    onSlashDown: () => undefined,
    onSlashAccept: () => undefined,
    slashOpen: false,
    bufferRef: { current: { buffer: '', cursor: 0 } },
    ...overrides,
  };
  return { ctx, actions };
}

describe('parseInputChunk command hotkeys', () => {
  it('routes Ctrl+R to commandHotkeys.r without inserting text', () => {
    let called = 0;
    const { ctx, actions } = makeCtx({
      commandHotkeys: {
        r: () => {
          called += 1;
        },
      },
    });

    const remainder = parseInputChunk('\x12', ctx);

    expect(remainder).toBe('');
    expect(called).toBe(1);
    expect(actions).toEqual([]);
  });

  it('routes kitty-encoded Ctrl+R to commandHotkeys.r', () => {
    let called = 0;
    let cancelled = false;
    const { ctx, actions } = makeCtx({
      onCancel: () => {
        cancelled = true;
      },
      commandHotkeys: {
        r: () => {
          called += 1;
        },
      },
    });

    const remainder = parseInputChunk('\x1b[114;5u', ctx);

    expect(remainder).toBe('');
    expect(called).toBe(1);
    expect(cancelled).toBe(false);
    expect(actions).toEqual([]);
  });
});

describe('parseInputChunk Ctrl+C', () => {
  it('routes 0x03 to onInterrupt (graceful) instead of a hard exit when wired', () => {
    let interrupts = 0;
    const { ctx, actions } = makeCtx({
      onInterrupt: () => {
        interrupts += 1;
      },
    });

    const remainder = parseInputChunk('\x03', ctx);

    expect(interrupts).toBe(1);
    expect(remainder).toBe('');
    // No editor action is dispatched for Ctrl+C.
    expect(actions).toEqual([]);
  });

  it('stops parsing the chunk at Ctrl+C (does not dispatch trailing bytes)', () => {
    let interrupts = 0;
    const { ctx, actions } = makeCtx({
      onInterrupt: () => {
        interrupts += 1;
      },
    });

    // A byte after 0x03 must not be inserted — the interrupt short-circuits.
    parseInputChunk('\x03x', ctx);

    expect(interrupts).toBe(1);
    expect(actions).toEqual([]);
  });
});
