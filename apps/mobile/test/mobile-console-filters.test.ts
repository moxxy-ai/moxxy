import { describe, expect, it } from 'vitest';
import { installConsoleFilters, shouldIgnoreConsoleMessage } from '../src/consoleFilters';

describe('mobile console filters', () => {
  it('filters the React Native Web pointerEvents deprecation warning', () => {
    expect(shouldIgnoreConsoleMessage('props.pointerEvents is deprecated. Use style.pointerEvents')).toBe(true);
  });

  it('filters the React Native VirtualizedList large-list heuristic log', () => {
    expect(shouldIgnoreConsoleMessage(
      'VirtualizedList: You have a large list that is slow to update - make sure your renderItem function renders components that follow React performance best practices',
    )).toBe(true);
  });

  it('does not filter unrelated warnings', () => {
    expect(shouldIgnoreConsoleMessage('Something else happened')).toBe(false);
  });

  it('suppresses filtered info logs without muting unrelated logs', () => {
    const originalLog = console.log;
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      installConsoleFilters();
      console.log('VirtualizedList: You have a large list that is slow to update', { dt: 1000 });
      console.log('Allowed runtime log');
    } finally {
      console.log = originalLog;
    }

    expect(calls).toEqual([['Allowed runtime log']]);
  });
});
