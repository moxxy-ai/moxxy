import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SkillInfo } from '@moxxy/sdk';
import { useMentionPicker } from './useMentionPicker.js';

const skills: SkillInfo[] = [
  { id: 'builtin/browser', name: 'browser', label: 'Moxxy Browser', aliases: ['moxxy_browser'], description: 'Drive the in-window browser' },
  { id: 'plugin/computer-control', name: 'computer-control', label: 'Computer Use', aliases: ['computer_use'], description: 'Operate desktop apps' },
];

const render = (draft: string, caret = draft.length) =>
  renderHook(({ text, at }) => useMentionPicker(skills, text, at), { initialProps: { text: draft, at: caret } });

describe('useMentionPicker', () => {
  it('opens on an @ word and offers the skills that answer it', () => {
    const { result } = render('zrób to @');

    expect(result.current.open).toBe(true);
    expect(result.current.options.map((o) => o.label)).toEqual(['Computer Use', 'Moxxy Browser']);
    expect(result.current.active).toBe(0);
  });

  it('stays closed outside an @ word and when nothing answers', () => {
    expect(render('zrób to').result.current.open).toBe(false);
    expect(render('@zzz').result.current.open).toBe(false);
  });

  it('moves the highlight around the list and picks it into the text', () => {
    const { result } = render('zrób @');

    act(() => result.current.move(1));
    expect(result.current.active).toBe(1);
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    act(() => result.current.move(-1));
    expect(result.current.active).toBe(1);
    expect(result.current.pick()).toEqual({ text: 'zrób @moxxy_browser ', caret: 20 });
    expect(result.current.pick(0)).toEqual({ text: 'zrób @computer_use ', caret: 19 });
  });

  it('stays closed after Escape until another @ word is started', () => {
    const { result, rerender } = render('@com');

    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    rerender({ text: '@comp', at: 5 });
    expect(result.current.open).toBe(false);
    rerender({ text: '@comp i @', at: 9 });
    expect(result.current.open).toBe(true);
  });

  it('starts at the top of a list narrowed by more typing', () => {
    const { result, rerender } = render('@');

    act(() => result.current.move(1));
    rerender({ text: '@m', at: 2 });
    expect(result.current.active).toBe(0);
  });

  it('is closed with no skills known yet', () => {
    const { result } = renderHook(() => useMentionPicker(undefined, '@', 1));

    expect(result.current.open).toBe(false);
    expect(result.current.pick()).toBeNull();
  });
});
