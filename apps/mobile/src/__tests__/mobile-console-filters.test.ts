import { describe, expect, it } from 'vitest';
import { shouldIgnoreConsoleMessage } from '../consoleFilters';

describe('mobile console filters', () => {
  it('filters the React Native Web pointerEvents deprecation warning', () => {
    expect(shouldIgnoreConsoleMessage('props.pointerEvents is deprecated. Use style.pointerEvents')).toBe(true);
  });

  it('does not filter unrelated warnings', () => {
    expect(shouldIgnoreConsoleMessage('Something else happened')).toBe(false);
  });
});
