import { describe, expect, it } from 'vitest';
import { getSessionDraft, setSessionDraft } from './sessionDrafts';

describe('session composer drafts', () => {
  it('keeps drafts isolated by session and clears a consumed draft', () => {
    setSessionDraft('session-a', 'draft A');
    setSessionDraft('session-b', 'draft B');

    expect(getSessionDraft('session-a')).toBe('draft A');
    expect(getSessionDraft('session-b')).toBe('draft B');

    setSessionDraft('session-a', '');
    expect(getSessionDraft('session-a')).toBe('');
    expect(getSessionDraft('session-b')).toBe('draft B');
  });
});
