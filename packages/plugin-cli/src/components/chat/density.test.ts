import { afterEach, describe, expect, it } from 'vitest';
import { blockGap, tuiDensity } from './density.js';

const set = (value: string | undefined): void => {
  if (value === undefined) delete process.env.MOXXY_TUI_DENSITY;
  else process.env.MOXXY_TUI_DENSITY = value;
};

afterEach(() => set(undefined));

describe('transcript density', () => {
  it('leaves a blank line between entries by default', () => {
    // Unset must behave exactly as before the setting existed: nobody opted in.
    expect(tuiDensity()).toBe('comfortable');
    expect(blockGap()).toBe(1);
  });

  it('drops the separator when compact is asked for', () => {
    set('compact');

    expect(tuiDensity()).toBe('compact');
    expect(blockGap()).toBe(0);
  });

  it('treats an unrecognised value as the default rather than guessing', () => {
    // A presentation preference must never be the reason a terminal renders
    // strangely, so anything but the one opt-in word means "as before".
    for (const junk of ['', 'COMPACT', 'tight', 'true', '1']) {
      set(junk);
      expect(blockGap(), `${junk} should not enable compact`).toBe(1);
    }
  });
});
