import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetToastsForTests,
  dismissToast,
  getToasts,
  pushToast,
  subscribeToasts,
  TOAST_LIMIT,
} from './toast-store';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  __resetToastsForTests();
  vi.useRealTimers();
});

describe('toast store', () => {
  it('shows a pushed toast, newest last', () => {
    pushToast({ id: 'a', tone: 'info', title: 'First' });
    pushToast({ id: 'b', tone: 'success', title: 'Second', body: 'Done.' });

    expect(getToasts().map((toast) => toast.title)).toEqual(['First', 'Second']);
  });

  it('replaces a toast with the same id rather than stacking a second one', () => {
    pushToast({ id: 'model', tone: 'info', title: 'Downloading' });
    pushToast({ id: 'other', tone: 'info', title: 'Other' });
    pushToast({ id: 'model', tone: 'success', title: 'Ready' });

    expect(getToasts().map((toast) => toast.title)).toEqual(['Other', 'Ready']);
  });

  it('keeps only the newest few on screen', () => {
    for (let i = 0; i < TOAST_LIMIT + 2; i += 1) pushToast({ id: `t${i}`, tone: 'info', title: `T${i}` });

    expect(getToasts()).toHaveLength(TOAST_LIMIT);
    expect(getToasts().at(-1)!.title).toBe(`T${TOAST_LIMIT + 1}`);
  });

  it('goes away on its own, an error later than the rest', () => {
    pushToast({ id: 'ok', tone: 'success', title: 'Ready' });
    pushToast({ id: 'bad', tone: 'error', title: 'Failed' });

    vi.advanceTimersByTime(6_000);
    expect(getToasts().map((toast) => toast.id)).toEqual(['bad']);
    vi.advanceTimersByTime(4_000);
    expect(getToasts()).toEqual([]);
  });

  it('a replaced toast gets a fresh time on screen', () => {
    pushToast({ id: 'model', tone: 'info', title: 'One' });
    vi.advanceTimersByTime(5_000);
    pushToast({ id: 'model', tone: 'info', title: 'Two' });
    vi.advanceTimersByTime(5_000);

    expect(getToasts().map((toast) => toast.title)).toEqual(['Two']);
  });

  it('can be dismissed, and tells its listeners each time it changes', () => {
    const listener = vi.fn();
    const off = subscribeToasts(listener);
    pushToast({ id: 'a', tone: 'info', title: 'A' });
    dismissToast('a');
    off();
    pushToast({ id: 'b', tone: 'info', title: 'B' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getToasts().map((toast) => toast.id)).toEqual(['b']);
  });
});
