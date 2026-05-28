import { describe, expect, it, afterEach } from 'vitest';
import { currentWindowLabel, isMainWindow } from './window-context';

const originalLocation = window.location;

function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, search },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('currentWindowLabel', () => {
  it('returns "main" when no window query param is set', () => {
    setSearch('');
    expect(currentWindowLabel()).toBe('main');
    expect(isMainWindow()).toBe(true);
  });

  it('extracts the window param when present', () => {
    setSearch('?window=session-abc');
    expect(currentWindowLabel()).toBe('session-abc');
    expect(isMainWindow()).toBe(false);
  });

  it('falls back to "main" on empty window param', () => {
    setSearch('?window=');
    expect(currentWindowLabel()).toBe('main');
  });

  it('handles multiple query params', () => {
    setSearch('?foo=bar&window=session-xyz&baz=qux');
    expect(currentWindowLabel()).toBe('session-xyz');
  });
});
