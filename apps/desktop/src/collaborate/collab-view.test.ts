/**
 * Unit tests for the Collaborate panel's pure view helpers.
 *
 * These were inline in `CollaboratePanel.tsx` and so untestable without
 * rendering React; extracting them lets the channel filter (the one piece of
 * real logic) be exercised directly.
 */
import { describe, expect, it } from 'vitest';
import type { Block, CollabMsgView } from '@moxxy/chat-model';
import { dotColor, filterCollabMessages, latestCollab, taskChipBg } from './collab-view';

const msg = (over: Partial<CollabMsgView>): CollabMsgView => ({
  id: Math.random().toString(36).slice(2),
  from: 'a',
  to: 'b',
  body: 'hi',
  atMs: 0,
  ...over,
});

describe('filterCollabMessages', () => {
  const messages: CollabMsgView[] = [
    msg({ id: 'm1', from: 'human', to: 'all' }),
    msg({ id: 'm2', from: 'alice', to: 'bob' }),
    msg({ id: 'm3', from: 'bob', to: 'alice' }),
    msg({ id: 'm4', from: 'carol', to: 'carol' }),
  ];

  it('returns every message for the "all" channel', () => {
    expect(filterCollabMessages(messages, 'all')).toBe(messages);
  });

  it('keeps messages to/from the selected agent', () => {
    expect(filterCollabMessages(messages, 'alice').map((m) => m.id)).toEqual([
      'm1', // to === 'all' broadcast
      'm2', // to alice
      'm3', // from alice
    ]);
  });

  it('always includes team broadcasts (to === all)', () => {
    expect(filterCollabMessages(messages, 'carol').map((m) => m.id)).toEqual(['m1', 'm4']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterCollabMessages([msg({ from: 'x', to: 'y' })], 'z')).toEqual([]);
  });
});

describe('latestCollab', () => {
  it('returns the last collab block, ignoring later non-collab blocks', () => {
    const blocks = [
      { kind: 'collab', id: 'c1' },
      { kind: 'event', id: 'e1' },
      { kind: 'collab', id: 'c2' },
      { kind: 'event', id: 'e2' },
    ] as unknown as Block[];
    expect(latestCollab(blocks)?.id).toBe('c2');
  });

  it('returns undefined when there is no collab block', () => {
    const blocks = [{ kind: 'event', id: 'e1' }] as unknown as Block[];
    expect(latestCollab(blocks)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(latestCollab([])).toBeUndefined();
  });
});

describe('dotColor', () => {
  it('maps known statuses, falling back to dim', () => {
    expect(dotColor('done')).toBe('var(--color-green)');
    expect(dotColor('crashed')).toBe('var(--color-red)');
    expect(dotColor('killed')).toBe('var(--color-red)');
    expect(dotColor('working')).toBe('var(--color-primary)');
    expect(dotColor('pending')).toBe('var(--color-text-dim)');
  });
});

describe('taskChipBg', () => {
  it('maps known statuses, falling back to dim', () => {
    expect(taskChipBg('done')).toBe('var(--color-green)');
    expect(taskChipBg('blocked')).toBe('var(--color-amber)');
    expect(taskChipBg('in_progress')).toBe('var(--color-primary)');
    expect(taskChipBg('claimed')).toBe('var(--color-primary)');
    expect(taskChipBg('todo')).toBe('var(--color-text-dim)');
  });
});
